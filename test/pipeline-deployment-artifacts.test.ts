import {App, Stack, Token} from "aws-cdk-lib";
import {PipelineDeploymentArtifacts} from "../lib";
import {Bucket} from "aws-cdk-lib/aws-s3";

describe('Pipeline deployment artifacts', () => {
    it('s3 artifacts paths are created correctly', () => {
        const app = new App();
        const stack = new Stack(app, "TestStack");
        const bucket = new Bucket(stack, 'test-bucket', {
            bucketName: 'test-bucket'
        })
        const bucketName = Token.asString(bucket.bucketName);
        const pipelineDeploymentArtifacts = new PipelineDeploymentArtifacts(
            {
                artifactOutputBucket: bucket,
                // Assert that the bucket name is set correctly
                artifactOutputPath: 'some/s3/path/myZippedApplication.zip'
            }
        )
        const resolvedBucketName = stack.resolve(bucket.bucketName);
        expect(pipelineDeploymentArtifacts.getArtifactS3Path()).toBe('some/s3/path/myZippedApplication.zip')
        expect(pipelineDeploymentArtifacts.getFullS3Path()).toBe(`s3://${bucketName}/some/s3/path/myZippedApplication.zip`)
    });

    it('path is standardized', () => {
        const app = new App();
        const stack = new Stack(app, "TestStack");
        const bucket = new Bucket(stack, 'test-bucket', {
            bucketName: 'test-bucket'
        })
        const bucketName = Token.asString(bucket.bucketName);
        const pipelineDeploymentArtifacts = new PipelineDeploymentArtifacts(
            {
                artifactOutputBucket: bucket,
                artifactOutputPath: '//some/s3/path/myZippedApplication.zip'
            }
        )
        expect(pipelineDeploymentArtifacts.getArtifactS3Path()).toBe('some/s3/path/myZippedApplication.zip')
        expect(pipelineDeploymentArtifacts.getFullS3Path()).toBe(`s3://${bucketName}/some/s3/path/myZippedApplication.zip`)
    });
});
