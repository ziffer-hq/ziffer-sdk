import { tool } from './tool.js';

/**
 * A ticket server and a deploy server on ONE client: the pair spans two
 * servers, which is the point. Built for read_ticket+production_write.
 */
export const JIRA_DEPLOY = [
  tool('VS Code', 'jira', 'get_issue', 'Returns one issue with its comments.', ['issueKey']),
  tool('VS Code', 'jira', 'search_issues', 'Searches issues with JQL.', ['jql']),
  tool('VS Code', 'deployer', 'deploy_service', 'Deploys a service to production.', ['service', 'version']),
];
