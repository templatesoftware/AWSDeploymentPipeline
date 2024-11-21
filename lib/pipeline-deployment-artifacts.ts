import {Bucket} from "aws-cdk-lib/aws-s3";

export interface PipelineDeploymentArtifactsProps {
    readonly artifactOutputBucket: Bucket;

    readonly artifactOutputPath: string;
}

/**
 * Storage for the pipeline's latest deployment, stored in either S3 or EC%
 */
export class PipelineDeploymentArtifacts {

    readonly artifactOutputBucket: string;
    readonly artifactOutputPath: string;

    public constructor(props: PipelineDeploymentArtifactsProps) {
        this.artifactOutputBucket = props.artifactOutputPath;
        this.artifactOutputPath = props.artifactOutputPath
    }

}
