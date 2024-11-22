import {Stack, StackProps} from 'aws-cdk-lib';
import {Construct} from 'constructs';
import {Artifact, IStage, Pipeline, PipelineType} from "aws-cdk-lib/aws-codepipeline";
import {PolicyStatement} from "aws-cdk-lib/aws-iam";
import {PipelineStage} from "./deployment-stack";
import {DeploymentStage} from "./deployment-stage";
import {IAction} from "aws-cdk-lib/aws-codepipeline/lib/action";
import {AutoBuildRepository} from "./auto-build-repository";
import {toTitleCase} from "./utils/title-case";
import {getFormattedDateForFilePath} from "./utils/date-time";
import {Bucket} from "aws-cdk-lib/aws-s3";
import {v4 as uuidv4} from 'uuid';
import {BuildSpec, LinuxBuildImage, Project} from "aws-cdk-lib/aws-codebuild";
import {CloudFormationCreateUpdateStackAction, CodeBuildAction} from "aws-cdk-lib/aws-codepipeline-actions";
import {PipelineDeploymentArtifacts} from "./pipeline-deployment-artifacts";

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
    readonly pipelineDeploymentArtifacts: PipelineDeploymentArtifacts;

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
        const synthAction = new Project(this, `${props.pipelineName}-pipeline-synthesis`, {
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
        // deploy latest CDK changes
        const pipelineMutationAction = new Project(this, `${props.pipelineName}-pipeline-mutation`, {
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
                        commands: [`npx cdk deploy ${this.stackName} --require-approval=never`]
                    }
                },
            }),
        });
        // allow the pipeline to self mutate
        pipelineMutationAction.addToRolePolicy(
            new PolicyStatement({
                actions: ['sts:AssumeRole', 'ssm:GetParameter*'],
                resources: ['*'],
            })
        );
        const cdkSourceCodeArtifact = this.repositoryToBuildArtifact.get(this.cdkSourceRepository)!
        this.cloudAssemblyOutput = new Artifact();
        this.pipeline.addStage({
            stageName: 'Synthesis',
            actions: [
                new CodeBuildAction({
                    actionName: 'CDK-Synthesis',
                    project: synthAction,
                    input: cdkSourceCodeArtifact,
                    outputs: [this.cloudAssemblyOutput],
                }),
            ]
        })
        this.pipeline.addStage({
            stageName: 'Pipeline',
            actions: [
                new CodeBuildAction({
                    actionName: 'Self-Mutate',
                    project: pipelineMutationAction,
                    input: this.cloudAssemblyOutput,
                }),
            ]
        })

        const codeReplicationBucket = new Bucket(this, `${props.pipelineName}-code-replication-bucket`)
        // get a uuid for the artifact upload to avoid collisions
        const uuid: string = uuidv4().substring(0, 6);
        const now = new Date();
        const date = getFormattedDateForFilePath(now)
        const path = `${date}-${uuid}`
        const replicationActions: CodeBuildAction[] = this.getAllRepositoriesToBuild(props).map(
            autoBuildRepository => {
                return new CodeBuildAction(
                    {
                        actionName: `${autoBuildRepository.repo}-Replication`,
                        project: this.getCodeBuildReplicationProject(
                            autoBuildRepository,
                            path,
                            codeReplicationBucket
                        ),
                        input: this.getBuildArtifact(autoBuildRepository)
                    }
                )
            }
        )
        codeReplicationBucket.grantReadWrite(
            pipelineMutationAction.role!
        )

        // for each source repository, zip it up and upload it to S3 or EMR for later distribution
        this.pipeline.addStage({
            stageName: 'Code-Replication',
            actions: replicationActions
        })

        /**
         * how do we replicate deployment artifacts for each and every stage? and target within a stage?
         */
        this.pipelineDeploymentArtifacts = new PipelineDeploymentArtifacts(
            {
                artifactOutputBucket: codeReplicationBucket,
                artifactOutputPath: path
            }
        )
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
                adminPermissions: true,
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
     * @param path prefix to use within s3Bucket
     * @param bucket bucket to upload replicated code to
     * @private build project to zip and upload a source repository
     */
    private getCodeBuildReplicationProject(
        autoBuildRepository: AutoBuildRepository,
        path: string,
        bucket: Bucket): Project {
        const zipArchiveName = `${autoBuildRepository.repo}.zip`
        const project = new Project(this, `${autoBuildRepository.repo}-replication`, {
            buildSpec: BuildSpec.fromObject({
                env: {
                    variables: {
                        ARTIFACT_NAME: zipArchiveName,
                        S3_OBJECT_PATH: path,
                        BUCKET_NAME: bucket.bucketName,
                    },
                },
                version: '0.2',
                phases: {
                    install: {
                        commands: ['npm install -g zip'],
                    },
                    build: {
                        commands: [
                            'ls -ltr',
                            'echo ARTIFACT_NAME: $ARTIFACT_NAME',
                            'echo S3_OBJECT_PATH: $S3_OBJECT_PATH',
                            'echo BUCKET_NAME: $BUCKET_NAME',
                            'zip -r $ARTIFACT_NAME .',
                            'ls -lthr',
                            'aws s3 cp $ARTIFACT_NAME s3://$BUCKET_NAME/$S3_OBJECT_PATH/$ARTIFACT_NAME',
                        ],
                    },
                }
            })
        });
        project.addToRolePolicy(
            new PolicyStatement({
                actions: ['s3:PutObject'],
                resources: [
                    bucket.bucketArn,
                    `${bucket.bucketArn}/*`
                ],
            })
        );
        project.addToRolePolicy(
            new PolicyStatement({
                actions: ['sts:AssumeRole'],
                resources: ['*'],
            })
        );
        return project
    }

    /**
     * Given an input repository return its build artifacts
     * @param autoBuildRepository
     */
    private getBuildArtifact(autoBuildRepository: AutoBuildRepository): Artifact {
        return this.repositoryToBuildArtifact.get(autoBuildRepository)!;
    }

    private getLatestDeploymentArtifacts(): PipelineDeploymentArtifacts {
        return this.pipelineDeploymentArtifacts;
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
