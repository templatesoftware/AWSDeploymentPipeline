import {Stack, StackProps} from 'aws-cdk-lib';
import {Construct} from 'constructs';
import {PipelineStage} from "./deployment-stack";

export interface DeploymentStageProps extends StackProps {
    pipelineStage: PipelineStage;
}

/**
 * A logical grouping of stacks to deploy to a specific stage e.g. deploy the database, networking, and compute stacks
 * to the beta stage
 */
export class DeploymentStage extends Construct {
    // stacks to deploy as part of the stage
    stages: Stack[];

    public constructor(scope: Construct, id: string, props: DeploymentStageProps) {
        super(scope, id);
        this.stages = []
    }

    addStackToStage(stage: Stack) {
        this.stages.push(stage)
    }
}
