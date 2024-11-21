import {Bucket} from "aws-cdk-lib/aws-s3";
import * as path from 'path';


export interface PipelineDeploymentArtifactsProps {
    readonly artifactOutputBucket: Bucket;

    readonly artifactOutputPath: string;
}

/**
 * Storage for the pipeline's latest deployment, stored in either S3 or EC%
 */
export class PipelineDeploymentArtifacts {

    private readonly artifactOutputBucket: Bucket;
    private readonly artifactOutputPath: string;

    public constructor(props: PipelineDeploymentArtifactsProps) {
        this.artifactOutputBucket = props.artifactOutputBucket;
        this.artifactOutputPath = props.artifactOutputPath
    }

    /**
     * Get the latest s3 path for the output artifacts - leading slash removed
     */
    public getArtifactS3Path(): string {
        return this.artifactOutputPath.replace(/^\/+/, '')
    }

    /**
     * Get full S3 path including bucket name
     */
    public getFullS3Path(): string {
        const leadingSlashRemoved = this.getArtifactS3Path()
        const fullOutputPath = path.normalize(path.join(this.artifactOutputBucket.bucketName, leadingSlashRemoved))
        return `s3://${fullOutputPath}`
    }

}
