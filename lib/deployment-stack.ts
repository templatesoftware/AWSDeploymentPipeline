import {Stack, StackProps} from 'aws-cdk-lib';
import {Construct} from 'constructs';

export interface PipelineStage {
    readonly stage: Stage;
    readonly isProd: boolean;
}

export enum Stage {
    DEV = "dev",
    BETA = "beta",
    GAMMA = "gamma",
    PROD = "prod"
}

export const DEV_STAGE: PipelineStage = {
    stage: Stage.DEV,
    isProd: false
}

export const BETA_STAGE: PipelineStage = {
    stage: Stage.BETA,
    isProd: false
}
export const GAMMA_STAGE: PipelineStage = {
    stage: Stage.GAMMA,
    isProd: false
}
export const PROD_STAGE: PipelineStage = {
    stage: Stage.PROD,
    isProd: true
}

export interface DeploymentStackProps extends StackProps {
    stage: Stage
    isProd: boolean;
}

/**
 * Stack deployable from a deployment pipeline
 */
export abstract class DeploymentStack extends Stack {
    protected constructor(scope: Construct, id: string, props: DeploymentStackProps) {
        super(scope, id, props);
    }
}


