import {AutoBuildRepository} from "../lib/auto-build-repository";
import {CodeBuildAction} from "aws-cdk-lib/aws-codepipeline-actions";
import {App, Stack} from "aws-cdk-lib";
import {Artifact, Pipeline} from 'aws-cdk-lib/aws-codepipeline';
import {PipelineProject} from "aws-cdk-lib/aws-codebuild";
import {Template} from "aws-cdk-lib/assertions";

describe('Auto build repository', () => {
    test('Auto build repository creates action correctly', () => {
        const app = new App();
        const stack = new Stack(app, "TestStack");
        const autoBuildRepository = new AutoBuildRepository(
            {
                connectionArn: 'arn:aws:iam::123456789:some/resource',
                branch: 'main',
                owner: 'TemplateSoftware',
                repo: 'TestRepo'
            }
        )
        const testArtifact = new Artifact('test-artifact')
        const testOutputArtifact = new Artifact('test-output-artifact')
        const sourceAction = autoBuildRepository.createSourceAction(
            testArtifact
        )
        const pipeline = new Pipeline(stack, 'TestPipeline')
        pipeline.addStage(
            {
                stageName: 'Source',
                actions: [sourceAction]
            }
        )
        pipeline.addStage(
            {
                stageName: 'Build',
                actions: [new CodeBuildAction({
                    actionName: 'CodeBuild',
                    project: new PipelineProject(stack, 'MyProject'),
                    input: testArtifact,
                    outputs: [testOutputArtifact],
                })]
            }
        )
        Template.fromStack(stack).hasResourceProperties('AWS::CodePipeline::Pipeline', {
            'Stages': [
                {
                    'Name': 'Source',
                    'Actions': [
                        {
                            'Name': 'TestRepo-Source',
                            'ActionTypeId': {
                                'Owner': 'AWS',
                                'Provider': 'CodeStarSourceConnection',
                            },
                            'Configuration': {
                                'ConnectionArn': 'arn:aws:iam::123456789:some/resource',
                                'FullRepositoryId': 'TemplateSoftware/TestRepo',
                                'BranchName': 'main',
                            },
                        },
                    ],
                },
                {
                    'Name': 'Build',
                    'Actions': [
                        {
                            'Name': 'CodeBuild',
                        },
                    ],
                }
            ]
        })
    });
});




