/**
 * Temporal wiring for AgentCore. Deterministic: no Date, Math.random, I/O, or Node imports.
 */
import {
  ApplicationFailure,
  allHandlersFinished,
  condition,
  defineQuery,
  defineSignal,
  defineUpdate,
  setHandler,
  workflowInfo,
} from "@temporalio/workflow";
import { AdmissionQueue } from "./admission.js";
import { type ApprovalActivities, installApprovalGate } from "./approval.js";
import type {
  Admission,
  AgentCore,
  ChatInput,
  CoreStatus,
  RotationHint,
  ScheduleFiredInput,
  TurnHandler,
} from "./types.js";
import {
  CHAT_UPDATE,
  CLOSE_SIGNAL,
  ROTATION_QUERY,
  SCHEDULE_UPDATE,
  STATUS_QUERY,
} from "./types.js";

export const chatUpdate = defineUpdate<Admission, [ChatInput]>(CHAT_UPDATE);
export const scheduleFiredUpdate = defineUpdate<Admission, [ScheduleFiredInput]>(SCHEDULE_UPDATE);
export const closeSignal = defineSignal(CLOSE_SIGNAL);
export const statusQuery = defineQuery<CoreStatus>(STATUS_QUERY);
export const rotationQuery = defineQuery<RotationHint>(ROTATION_QUERY);

function validateChatInput(input: unknown): asserts input is ChatInput {
  if (
    input === null ||
    typeof input !== "object" ||
    typeof (input as ChatInput).key !== "string" ||
    typeof (input as ChatInput).text !== "string" ||
    !(input as ChatInput).key
  ) {
    throw ApplicationFailure.nonRetryable("BadInput", "BadInput");
  }
}

function validateScheduleFired(input: unknown): asserts input is ScheduleFiredInput {
  if (
    input === null ||
    typeof input !== "object" ||
    typeof (input as ScheduleFiredInput).key !== "string" ||
    typeof (input as ScheduleFiredInput).scheduleId !== "string" ||
    !(input as ScheduleFiredInput).key ||
    !(input as ScheduleFiredInput).scheduleId
  ) {
    throw ApplicationFailure.nonRetryable("BadInput", "BadInput");
  }
}

export function createOwnCore(opts?: {
  rotateAfterAccepted?: number;
  /** Enable approval gate handlers (v1 ask mode). Default false for pure chat fixtures; AnyBot enables. */
  approvals?: boolean;
  approvalActivities?: ApprovalActivities;
  approvalTtlMs?: number;
  /** Enable scheduleFired update (v1 WP4). Default false for pure chat fixtures; AnyBot enables. */
  schedules?: boolean;
}): AgentCore {
  const queue = new AdmissionQueue(opts);
  const withApprovals = opts?.approvals === true;
  const withSchedules = opts?.schedules === true;

  return {
    async run(handler: TurnHandler): Promise<void> {
      const gate = withApprovals
        ? installApprovalGate({
            ...(opts?.approvalActivities ? { activities: opts.approvalActivities } : {}),
            ...(opts?.approvalTtlMs !== undefined
              ? { defaultExpiresInMs: opts.approvalTtlMs }
              : {}),
          })
        : undefined;

      setHandler(
        chatUpdate,
        (input) => {
          validateChatInput(input);
          return queue.admit(input);
        },
        {
          validator: (input) => {
            if (queue.isClosing) {
              throw ApplicationFailure.nonRetryable("AgentClosed", "AgentClosed");
            }
            validateChatInput(input);
          },
        },
      );
      if (withSchedules) {
        setHandler(
          scheduleFiredUpdate,
          (input) => {
            validateScheduleFired(input);
            // Placeholder chat fields; AnyBot resolveSchedule fills them in the turn handler.
            return queue.admit({
              key: input.key,
              chatId: "",
              messageId: `schedule:${input.scheduleId}`,
              authorId: "",
              text: "",
              scheduleId: input.scheduleId,
            });
          },
          {
            validator: (input) => {
              if (queue.isClosing) {
                throw ApplicationFailure.nonRetryable("AgentClosed", "AgentClosed");
              }
              validateScheduleFired(input);
            },
          },
        );
      }
      setHandler(closeSignal, () => {
        queue.requestClose();
      });
      setHandler(statusQuery, () => {
        const info = workflowInfo();
        const base = queue.snapshot({
          historyLength: info.historyLength,
          continueAsNewSuggested: info.continueAsNewSuggested,
        });
        return gate ? gate.attachToStatus(base) : base;
      });
      setHandler(rotationQuery, () => {
        const info = workflowInfo();
        const base = queue.rotation({
          historyLength: info.historyLength,
          continueAsNewSuggested: info.continueAsNewSuggested,
        });
        return gate ? gate.attachToRotation(base) : base;
      });

      for (;;) {
        await condition(() => queue.hasWork || queue.isClosing);
        while (true) {
          const item = queue.next();
          if (!item) break;
          queue.begin(item.input);
          try {
            await handler(item.input, { turnNumber: item.turnNumber });
            queue.finish(true);
          } catch {
            queue.finish(false);
          }
        }
        if (queue.isClosing && !queue.hasWork) {
          await condition(allHandlersFinished);
          return;
        }
      }
    },
  };
}
