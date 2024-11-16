import {Stack, StackProps} from 'aws-cdk-lib';
import {Construct} from 'constructs';
import {Artifact, IStage, Pipeline, PipelineType} from "aws-cdk-lib/aws-codepipeline";
import {CloudFormationCreateUpdateStackAction, CodeBuildAction} from "aws-cdk-lib/aws-codepipeline-actions";
import {BuildSpec, LinuxBuildImage, PipelineProject} from "aws-cdk-lib/aws-codebuild";
import {PolicyStatement} from "aws-cdk-lib/aws-iam";
import {PipelineStage} from "./deployment-stack";
import {DeploymentStage} from "./deployment-stage";
import {IAction} from "aws-cdk-lib/aws-codepipeline/lib/action";
import {AutoBuildRepository} from "./auto-build-repository";
import {toTitleCase} from "./utils/title-case";

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

        const repositoryToBuildArtifact = new Map<AutoBuildRepository, Artifact>();
        const autoBuildSourceActions: IAction[] = [this.cdkSourceRepository]
            .concat(props.additionalAutoBuildRepositories)
            .map(autoBuildRepo => {
                const autoBuiltRepoArtifact = new Artifact(autoBuildRepo.repo)
                repositoryToBuildArtifact.set(autoBuildRepo, autoBuiltRepoArtifact)
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
        const cdkSourceCodeArtifact = repositoryToBuildArtifact.get(this.cdkSourceRepository)!
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
}
