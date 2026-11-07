export const GATEWAY_PACKAGE = "@anyagent/gateway" as const;

export {
  type AgentDiscovery,
  type AgentMap,
  startAgentDiscovery,
  type TrackedAgent,
} from "./agents.js";
export {
  type ApprovalWatcher,
  type ApprovalWatcherOpts,
  type DecisionClient,
  evaluateApprovalMessage,
  evaluateApprovalObject,
  loadApproverContext,
  type PendingApprovalView,
  pendingFromObject,
  startApprovalWatcher,
  TemporalDecisionClient,
} from "./approvals.js";
export {
  type DeliverAndCommitOpts,
  type DeliveryClient,
  type DeliveryTarget,
  deliverAndCommit,
  TemporalDeliveryClient,
} from "./delivery.js";
export { type GatewayLogFields, logGateway } from "./log.js";
export {
  chatEvent,
  messageKey,
  type PipelineAgent,
  type PipelineInput,
  type PipelineOutcome,
  pipelineEvent,
  sourceForChat,
} from "./pipeline.js";
export {
  type MaybeRotateOpts,
  maybeRotate,
  type RotationClient,
  TemporalRotationClient,
} from "./rotation.js";
export { GatewayState } from "./state.js";
export {
  type MultiOrgGateway,
  type OrgSupervisor,
  type OrgSupervisorOpts,
  startGateway,
  startOrgSupervisor,
} from "./supervisor.js";
