import {DeploymentStage} from "../lib/deployment-stage";
import {BETA_STAGE, DEV_STAGE, GAMMA_STAGE, PROD_STAGE} from "../lib/deployment-stack";
import {App, Stack} from "aws-cdk-lib";


test('Default pipelineStages created correctly ', () => {
    expect(DEV_STAGE.stage).toBe('dev');
    expect(DEV_STAGE.isProd).toBe(false);
    expect(BETA_STAGE.stage).toBe('beta');
    expect(BETA_STAGE.isProd).toBe(false);
    expect(GAMMA_STAGE.stage).toBe('gamma');
    expect(GAMMA_STAGE.isProd).toBe(false);
    expect(PROD_STAGE.stage).toBe('prod');
    expect(PROD_STAGE.isProd).toBe(true);
});
