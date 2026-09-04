CREATE INDEX "Release_shop_decisionAt_idx"
ON "Release"("shop", "decisionAt");

CREATE INDEX "OperationJob_shop_deploymentProfile_createdAt_idx"
ON "OperationJob"("shop", "deploymentProfile", "createdAt");

CREATE INDEX "OperationJob_shop_deploymentProfile_completedAt_idx"
ON "OperationJob"("shop", "deploymentProfile", "completedAt");

CREATE INDEX "SystemIssue_shop_deploymentProfile_firstSeenAt_idx"
ON "SystemIssue"("shop", "deploymentProfile", "firstSeenAt");

CREATE INDEX "SubmissionEvent_type_createdAt_idx"
ON "SubmissionEvent"("type", "createdAt");

CREATE INDEX "NotificationDelivery_shop_status_createdAt_idx"
ON "NotificationDelivery"("shop", "status", "createdAt");
