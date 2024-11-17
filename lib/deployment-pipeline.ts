import {Stack, StackProps} from 'aws-cdk-lib';
import {Construct} from 'constructs';
import {Artifact, IStage, Pipeline, PipelineType} from "aws-cdk-lib/aws-codepipeline";
import {CloudFormationCreateUpdateStackAction, CodeBuildAction} from "aws-cdk-lib/aws-codepipeline-actions";
import {
    BuildEnvironmentVariable,
    BuildSpec,
    IProject,
    LinuxBuildImage,
    PipelineProject
} from "aws-cdk-lib/aws-codebuild";
import {PolicyStatement} from "aws-cdk-lib/aws-iam";
import {PipelineStage} from "./deployment-stack";
import {DeploymentStage} from "./deployment-stage";
import {IAction} from "aws-cdk-lib/aws-codepipeline/lib/action";
import {AutoBuildRepository} from "./auto-build-repository";
import {toTitleCase} from "./utils/title-case";
import {Bucket} from "aws-cdk-lib/aws-s3";
import {CodeBuildActionType} from "aws-cdk-lib/aws-codepipeline-actions/lib/codebuild/build-action";
import {v4 as uuidv4} from 'uuid';

export interface DeploymentPipelineProps extends StackProps {
    /** pipeline name */
    readonly pipelineName: string;

    /** the CDK repository responsible for managing this pipeline */
    readonly cdkSourceRepository: AutoBuildRepository

    /** repositories to auto build */
    readonly additionalAutoBuildRepositories: AutoBuildRepository[];
}

export class DeploymentPipeline extends Stack {
    readonly pipeline: Pipeline;
    readonly cloudAssemblyOutput: Artifact;
    readonly cdkSourceRepository: AutoBuildRepository;
    readonly repositoryToBuildArtifact: Map<AutoBuildRepository, Artifact>;

    constructor(scope: Construct, id: string, props: DeploymentPipelineProps) {
        super(scope, id, props);
        this.cdkSourceRepository = props.cdkSourceRepository
        this.pipeline = new Pipeline(this, `${props.pipelineName}-CodePipeline`, {
            pipelineName: props.pipelineName,
            pipelineType: PipelineType.V2
        })

        const sourceStage = this.pipeline.addStage({
            stageName: 'Source'
        });

        this.repositoryToBuildArtifact = new Map<AutoBuildRepository, Artifact>();
        const autoBuildSourceActions: IAction[] = this.getAllRepositoriesToBuild(props)
            .map(autoBuildRepo => {
                const autoBuiltRepoArtifact = new Artifact(autoBuildRepo.repo)
                this.repositoryToBuildArtifact.set(autoBuildRepo, autoBuiltRepoArtifact)
                return autoBuildRepo.createSourceAction(
                    autoBuiltRepoArtifact
                )
            })
        autoBuildSourceActions.forEach(sourceAction =>
            sourceStage.addAction(sourceAction)
        )
        const synthAction = new PipelineProject(this, `${props.pipelineName}-pipeline-synthesis`, {
            projectName: `${props.pipelineName}-pipeline-synthesis`,
            environment: {
                buildImage: LinuxBuildImage.STANDARD_7_0,
            },
            buildSpec: BuildSpec.fromObject({
                version: '0.2',
                phases: {
                    install: {
                        commands: ['npm install -g aws-cdk', 'npm ci'],
                    },
                    build: {
                        commands: [`npx cdk synth`],
                    },
                },
                artifacts: {
                    files: ['**/*'],
                },
            }),
        });
        const pipelineMutationAction = new PipelineProject(this, `${props.pipelineName}-pipeline-mutation`, {
            projectName: `${props.pipelineName}-pipeline-mutation`,
            environment: {
                buildImage: LinuxBuildImage.STANDARD_7_0,
            },
            buildSpec: BuildSpec.fromObject({
                version: '0.2',
                phases: {
                    install: {
                        commands: ['npm ci'],
                    },
                    build: {
                        commands: [`npx cdk deploy ${this.stackName} --require-approval=never`, `echo new commands`,]
                    }
                },
            }),
        });
        // allow the pipeline to self mutate self mutation
        pipelineMutationAction.addToRolePolicy(
            new PolicyStatement({
                actions: ['sts:AssumeRole', 'ssm:GetParameter*'],
                resources: ['*'],
            })
        );
        const cdkSourceCodeArtifact = this.repositoryToBuildArtifact.get(this.cdkSourceRepository)!
        this.cloudAssemblyOutput = new Artifact();
        this.pipeline.addStage({
            stageName: 'CDKSynthesis',
            actions: [
                new CodeBuildAction({
                    actionName: 'CDKSynth',
                    project: synthAction,
                    input: cdkSourceCodeArtifact,
                    outputs: [this.cloudAssemblyOutput],
                    type: CodeBuildActionType.BUILD,
                }),
            ]
        })
        this.pipeline.addStage({
            stageName: 'Pipeline',
            actions: [
                new CodeBuildAction({
                    actionName: 'SelfMutate',
                    project: pipelineMutationAction,
                    input: this.cloudAssemblyOutput,
                    type: CodeBuildActionType.BUILD,
                }),
            ]
        })

        const codeReplicationBucket = new Bucket(this, `${props.pipelineName}-code-replication-bucket`)
        // get a uuid for the artifact upload to avoid collisions
        const uuid: string = uuidv4().substring(0, 6);
        const pathPrefix = `${new Date()}-${uuid}/`
        const codeBuildProject: IProject = this.getCodeBuildReplicationProject(
            props.additionalAutoBuildRepositories[0]!,
            pathPrefix,
            codeReplicationBucket
        );
        const replicationActions: CodeBuildAction[] = props.additionalAutoBuildRepositories.map(
            autoBuildRepository => {
                return new CodeBuildAction(
                    {
                        actionName: `${autoBuildRepository.repo}-Replication`,
                        project: this.getCodeBuildReplicationProject(
                            autoBuildRepository,
                            pathPrefix,
                            codeReplicationBucket
                        ),
                        input: this.getBuildArtifact(autoBuildRepository)
                    }
                )
            }
        )

        // for each additional source repository, zip it up and upload it to S3 or EMR for later distribution
        this.pipeline.addStage({
            stageName: 'CodeReplication',
            actions: replicationActions
        })
    }

    /**
     * Add a deployment stage to the pipeline
     * @param piplineStage
     * @param deploymentStage
     */
    public addDeploymentStage(piplineStage: PipelineStage, deploymentStage: DeploymentStage): IStage {
        const stageName = toTitleCase(`${piplineStage.stage}`)
        const actions: IAction[] = deploymentStage.stages.map(stage =>
            new CloudFormationCreateUpdateStackAction({
                actionName: `${stage.stackName}`,
                stackName: stage.stackName,
                templatePath: this.cloudAssemblyOutput.atPath(`cdk.out/${stage.stackName}.template.json`),
                adminPermissions: true
            })
        );
        // create a stage with the given deployment actions
        return this.pipeline.addStage({
            stageName: stageName,
            actions: actions
        });
    }

    /**
     * Creates a build project that builds a pipeline's input repository and uploads it into S3 for later distribution
     * @param autoBuildRepository source repository to replicate
     * @param pathPrefix prefix to use within s3Bucket
     * @param bucket bucket to upload replicated code to
     * @private build project to zip and upload a source repository
     */
    private getCodeBuildReplicationProject(
        autoBuildRepository: AutoBuildRepository,
        pathPrefix: string,
        bucket: Bucket): IProject {
        const zipArchiveName = `${autoBuildRepository.repo}.zip`
        const buildEnvironmentVariables: { [key: string]: BuildEnvironmentVariable } = {
            ARTIFACT_NAME: {value: zipArchiveName},
            S3_OBJECT_PATH: {value: pathPrefix},
            BUCKET_NAME: {value: bucket.bucketName}, // Pass bucket name as a variable
        };
        return new PipelineProject(this, 'BuildProject', {
            buildSpec: BuildSpec.fromObject({
                version: '0.2',
                phases: {
                    install: {
                        commands: ['npm install -g zip'],
                    },
                    build: {
                        commands: [
                            'ls -ltr',
                            'echo "ARTIFACT_NAME: $ARTIFACT_NAME',
                            'echo "S3_OBJECT_PATH: $S3_OBJECT_PATH',
                            'echo "BUCKET_NAME: $BUCKET_NAME"',
                            'zip -r $ARTIFACT_NAME .',
                            'aws s3 cp $ARTIFACT_NAME s3://$BUCKET_NAME/$S3_OBJECT_PATH/$ARTIFACT_NAME',
                        ],
                    },
                },
                environment: {
                    environmentVariables: buildEnvironmentVariables,
                },
            })
        });
    }

    /**
     * Given an input repository return its build artifacts
     * @param autoBuildRepository
     */
    private getBuildArtifact(autoBuildRepository: AutoBuildRepository): Artifact {
        return this.repositoryToBuildArtifact.get(autoBuildRepository)!;
    }


    /**
     * Get all repos to auto build, including the cdk source repo
     * @param props pipeline props
     */
    private getAllRepositoriesToBuild(props: DeploymentPipelineProps) {
        return [this.cdkSourceRepository]
            .concat(props.additionalAutoBuildRepositories);
    }
}
