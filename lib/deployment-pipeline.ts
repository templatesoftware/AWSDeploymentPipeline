import {Stack, StackProps} from 'aws-cdk-lib';
import {Construct} from 'constructs';
import {Artifact, IStage, Pipeline, PipelineType} from "aws-cdk-lib/aws-codepipeline";
import {
    CloudFormationCreateUpdateStackAction,
    CodeBuildAction,
    S3DeployAction
} from "aws-cdk-lib/aws-codepipeline-actions";
import {BuildSpec, LinuxBuildImage, PipelineProject} from "aws-cdk-lib/aws-codebuild";
import {PolicyStatement} from "aws-cdk-lib/aws-iam";
import {PipelineStage} from "./deployment-stack";
import {DeploymentStage} from "./deployment-stage";
import {IAction} from "aws-cdk-lib/aws-codepipeline/lib/action";
import {AutoBuildRepository} from "./auto-build-repository";
import {toTitleCase} from "./utils/title-case";
import {Bucket} from "aws-cdk-lib/aws-s3";

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
        // allow self mutation
        pipelineMutationAction.addToRolePolicy(new PolicyStatement({
            actions: ['sts:AssumeRole'],
            resources: ['*'],
        }));
        pipelineMutationAction.addToRolePolicy(new PolicyStatement({
            actions: ['ssm:GetParameter*'],
            resources: ['*'],
        }));
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
                }),
            ]
        })
        const codeReplicationBucket = new Bucket(this, `${props.pipelineName}-code-replication-bucket`)
        this.pipeline.addStage({
            stageName: 'CodeReplication',
            actions: this.getAllRepositoriesToBuild(props)
                .map(autoBuildRepo => {
                    return new S3DeployAction(
                        {
                            actionName: `${autoBuildRepo.repo}-replication`,
                            // can reference the variables
                            objectKey: `${autoBuildRepo.repo}-replication/`,
                            input: this.repositoryToBuildArtifact.get(autoBuildRepo)!,
                            bucket: codeReplicationBucket
                        }
                    )
                })
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
     * Given an input repository return its build artifacts
     * @param autoBuildRepository
     */
    public getBuildArtifact(autoBuildRepository: AutoBuildRepository): Artifact {
        return this.repositoryToBuildArtifact.get(autoBuildRepository)!;
    }

    /**
     * Get all repos to auto build, including the cdk source repo
     * @param props pipeline props
     */
    getAllRepositoriesToBuild(props: DeploymentPipelineProps) {
        return [this.cdkSourceRepository]
            .concat(props.additionalAutoBuildRepositories);
    }
}
