import {DeploymentStage} from "../lib/deployment-stage";
import {DEV_STAGE} from "../lib/deployment-stack";
import {App, Stack} from "aws-cdk-lib";


test('Stage added correctly', () => {
    const app = new App();
    const stack = new Stack(app, "TestStack");
    const deploymentStage = new DeploymentStage(app, 'DeploymentStage', {
        pipelineStage: DEV_STAGE
    })
    deploymentStage.addStackToStage(
        stack
    );
    expect(deploymentStage.stages.length).toBe(1);
    expect(deploymentStage.stages[0]).toBe(stack);
});
