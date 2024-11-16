import {CodeStarConnectionsSourceAction} from "aws-cdk-lib/aws-codepipeline-actions";
import {Artifact} from 'aws-cdk-lib/aws-codepipeline';
import {IAction} from "aws-cdk-lib/aws-codepipeline/lib/action";

export interface AutoBuildRepositoryProps {
    /** connection ARN */
    readonly connectionArn: string;

    /** owner */
    readonly owner: string;

    /** repo name */
    readonly repo: string;

    /** branch */
    readonly branch?: string;

    /** whether this repository controls this pipeline */
    readonly isCDKSourceRepository?: boolean;
}

/**
 * A repository (local, github, gitlab, etc...) that will be auto built by the pipeline any time there is a commit
 */
export class AutoBuildRepository {

    readonly connectionArn: string;
    readonly owner: string;
    readonly repo: string;
    readonly branch: string;

    public constructor(props: AutoBuildRepositoryProps) {
        this.connectionArn = props.connectionArn;
        this.owner = props.owner;
        this.repo = props.repo;
        this.branch = props.branch ?? 'main'
    }

    public createSourceAction(artifact: Artifact): IAction {
        return new CodeStarConnectionsSourceAction(
            {
                actionName: `${this.repo}-Source`,
                connectionArn: this.connectionArn,
                repo: this.repo,
                output: artifact,
                owner: this.owner,
                branch: this.branch
            }
        )
    }

}
