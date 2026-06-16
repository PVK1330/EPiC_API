import { Sequelize } from "sequelize";

// Platform Level Models (Shared)
import UserModel from "./platform/user.model.js";
import TenantOrganisationModel from "./tenant/tenantOrganisation.model.js";

// Tenant Level Models (Isolated)
import RoleModel from "./tenant/role.model.js";
import UnverifiedUserModel from "./tenant/unverifiedUser.model.js";
import CaseModel from "./tenant/case.model.js";
import CaseworkerProfileModel from "./tenant/caseworkerProfile.model.js";
import AdminUserPreferenceModel from "./tenant/adminUserPreference.model.js";
import VisaTypeModel from "./tenant/visaType.model.js";
import PetitionTypeModel from "./tenant/petitionType.model.js";
import CaseCategoryModel from "./tenant/caseCategory.model.js";
import EmailTemplateSettingModel from "./tenant/emailTemplateSetting.model.js";
import SlaSettingModel from "./tenant/slaSetting.model.js";
import SlaRuleModel from "./tenant/slaRule.model.js";
import PaymentSettingModel from "./tenant/paymentSetting.model.js";
import EscalationModel from "./tenant/escalation.model.js";
import PermissionModel from "./tenant/permission.model.js";
import RolePermissionModel from "./tenant/rolePermission.model.js";
import DocumentModel from "./tenant/document.model.js";
import CaseDocumentModel from "./tenant/caseDocument.model.js";
import CasePaymentModel from "./tenant/casePayment.model.js";
import CaseTimelineModel from "./tenant/caseTimeline.model.js";
import CaseCommunicationModel from "./tenant/caseCommunication.model.js";
import CaseNoteModel from "./tenant/caseNote.model.js";
import TaskModel from "./tenant/task.model.js";
import ApplicationFieldSettingModel from "./tenant/applicationFieldSetting.model.js";
import ApplicationCustomFieldModel from "./tenant/applicationCustomField.model.js";
import MessageModel from "./tenant/message.model.js";
import ConversationModel from "./tenant/conversation.model.js";
import RescheduleHistoryModel from "./tenant/rescheduleHistory.model.js";
import NotificationModel from "./tenant/notification.model.js";
import NotificationPreferenceModel from "./tenant/notificationPreference.model.js";
import DepartmentModel from "./tenant/department.model.js";
import CandidateAccountSettingsModel from "./tenant/candidateAccountSettings.model.js";
import CandidateFeedbackModel from "./tenant/candidateFeedback.model.js";
import CandidateIssueReportModel from "./tenant/candidateIssueReport.model.js";
import CandidateApplicationModel from "./tenant/candidateApplication.model.js";
import SponsorProfileModel from "./tenant/sponsorProfile.model.js";
import AppointmentModel from "./tenant/appointment.model.js";
import CalendarMeetingModel from "./tenant/calendarMeeting.model.js";
import AuditLogModel from "./tenant/auditLog.model.js";
import LicenceApplicationModel from "./tenant/licenceApplication.model.js";
import LicenceApplicationAuditModel from "./tenant/licenceApplicationAudit.model.js";
import LicenceStageTaskModel from "./tenant/licenceStageTask.model.js";
// Sponsor Licence Application V2 — normalized section/child tables.
import LicenceApplicationRouteModel from "./tenant/licenceApplicationRoute.model.js";
import LicenceOrganisationInfoModel from "./tenant/licenceOrganisationInfo.model.js";
import LicenceCosRequirementModel from "./tenant/licenceCosRequirement.model.js";
import LicenceAppendixDocumentModel from "./tenant/licenceAppendixDocument.model.js";
import LicenceAuthorisingOfficerModel from "./tenant/licenceAuthorisingOfficer.model.js";
import LicenceKeyContactModel from "./tenant/licenceKeyContact.model.js";
import LicenceLevel1UserModel from "./tenant/licenceLevel1User.model.js";
import LicenceDeclarationModel from "./tenant/licenceDeclaration.model.js";
import LicenceGovernmentTrackingModel from "./tenant/licenceGovernmentTracking.model.js";
import CosRequestModel from "./tenant/cosRequest.model.js";
import ComplianceReviewHistoryModel from "./tenant/complianceReviewHistory.model.js";
import SponsorUserPreferenceModel from "./tenant/sponsorUserPreference.model.js";
import WorkerEventModel from "./tenant/workerEvent.model.js";
import DocumentChecklistModel from "./tenant/documentChecklist.model.js";
import DataCaptureTemplateModel from "./tenant/dataCaptureTemplate.model.js";
import DataCaptureSubmissionModel from "./tenant/dataCaptureSubmission.model.js";
import CaseCclRecordModel from "./tenant/caseCclRecord.model.js";
import CclTemplateModel from "./tenant/cclTemplate.model.js";
import SponsorChangeRequestModel from "./tenant/sponsorChangeRequest.model.js";
import RightToWorkRecordModel from "./tenant/rightToWorkRecord.model.js";
import AbsenceRecordModel from "./tenant/absenceRecord.model.js";
import SmsActivityLogModel from "./tenant/smsActivityLog.model.js";
import ComplianceDocumentModel from "./tenant/complianceDocument.model.js";
import ComplianceDocumentAuditModel from "./tenant/complianceDocumentAudit.model.js";
import CalendarConnectionModel from "./tenant/calendarConnection.model.js";
import ChangeRequestModel from "./tenant/changeRequest.model.js";
import ChangeRequestHistoryModel from "./tenant/changeRequestHistory.model.js";
import IntegrationSyncLogModel from "./tenant/integrationSyncLog.model.js";
import MeetingIntegrationModel from "./tenant/meetingIntegration.model.js";
import IntegrationRetryQueueModel from "./tenant/integrationRetryQueue.model.js";
import LicenceIntakeFormModel from "./tenant/licenceIntakeForm.model.js";
import LicenceIntakeDocumentModel from "./tenant/licenceIntakeDocument.model.js";
import LicenceInformationRequestModel from "./tenant/licenceInformationRequest.model.js";
import LicenceInformationRequestCommentModel from "./tenant/licenceInformationRequestComment.model.js";
import LicenceGrantRecordModel from "./tenant/licenceGrantRecord.model.js";
import CosAllocationRecordModel from "./tenant/cosAllocationRecord.model.js";
import SponsoredWorkerModel from "./tenant/sponsoredWorker.model.js";
import SponsoredWorkerAuditModel from "./tenant/sponsoredWorkerAudit.model.js";

/**
 * Register all models and associations on a Sequelize instance (main or tenant DB).
 * @param {import("sequelize").Sequelize} sequelize
 */
export function buildDb(sequelize) {
  const db = {};

  db.Sequelize = Sequelize;
  db.sequelize = sequelize;

  db.User = UserModel(sequelize, Sequelize.DataTypes);
  db.Organisation = TenantOrganisationModel(sequelize, Sequelize.DataTypes);
  db.Role = RoleModel(sequelize, Sequelize.DataTypes);
  db.UnverifiedUser = UnverifiedUserModel(sequelize, Sequelize.DataTypes);
  db.Case = CaseModel(sequelize, Sequelize.DataTypes);
  db.CaseworkerProfile = CaseworkerProfileModel(sequelize, Sequelize.DataTypes);
  db.AdminUserPreference = AdminUserPreferenceModel(sequelize, Sequelize.DataTypes);
  db.AuditLog = AuditLogModel(sequelize, Sequelize.DataTypes);
  db.DocumentChecklist = DocumentChecklistModel(sequelize, Sequelize.DataTypes);
  db.DataCaptureTemplate = DataCaptureTemplateModel(sequelize, Sequelize.DataTypes);
  db.DataCaptureSubmission = DataCaptureSubmissionModel(sequelize, Sequelize.DataTypes);
  db.CaseCclRecord = CaseCclRecordModel(sequelize, Sequelize.DataTypes);
  db.CclTemplate = CclTemplateModel(sequelize, Sequelize.DataTypes);
  db.VisaType = VisaTypeModel(sequelize, Sequelize.DataTypes);
  db.PetitionType = PetitionTypeModel(sequelize, Sequelize.DataTypes);
  db.CaseCategory = CaseCategoryModel(sequelize, Sequelize.DataTypes);
  db.EmailTemplateSetting = EmailTemplateSettingModel(sequelize, Sequelize.DataTypes);
  db.SlaSetting = SlaSettingModel(sequelize, Sequelize.DataTypes);
  db.SlaRule = SlaRuleModel(sequelize, Sequelize.DataTypes);
  db.PaymentSetting = PaymentSettingModel(sequelize, Sequelize.DataTypes);
  db.Escalation = EscalationModel(sequelize, Sequelize.DataTypes);
  db.Permission = PermissionModel(sequelize, Sequelize.DataTypes);
  db.RolePermission = RolePermissionModel(sequelize, Sequelize.DataTypes);
  db.Document = DocumentModel(sequelize, Sequelize.DataTypes);
  db.CaseDocument = CaseDocumentModel(sequelize, Sequelize.DataTypes);
  db.CasePayment = CasePaymentModel(sequelize, Sequelize.DataTypes);
  db.CaseTimeline = CaseTimelineModel(sequelize, Sequelize.DataTypes);
  db.CaseCommunication = CaseCommunicationModel(sequelize, Sequelize.DataTypes);
  db.CaseNote = CaseNoteModel(sequelize, Sequelize.DataTypes);
  db.Task = TaskModel(sequelize, Sequelize.DataTypes);
  db.ApplicationFieldSetting = ApplicationFieldSettingModel(sequelize, Sequelize.DataTypes);
  db.ApplicationCustomField = ApplicationCustomFieldModel(sequelize, Sequelize.DataTypes);
  db.Message = MessageModel(sequelize, Sequelize.DataTypes);
  db.Conversation = ConversationModel(sequelize, Sequelize.DataTypes);
  db.RescheduleHistory = RescheduleHistoryModel(sequelize, Sequelize.DataTypes);
  db.Notification = NotificationModel(sequelize, Sequelize.DataTypes);
  db.NotificationPreference = NotificationPreferenceModel(sequelize, Sequelize.DataTypes);
  db.Department = DepartmentModel(sequelize, Sequelize.DataTypes);
  db.CandidateAccountSettings = CandidateAccountSettingsModel(sequelize, Sequelize.DataTypes);
  db.CandidateFeedback = CandidateFeedbackModel(sequelize, Sequelize.DataTypes);
  db.CandidateIssueReport = CandidateIssueReportModel(sequelize, Sequelize.DataTypes);
  db.CandidateApplication = CandidateApplicationModel(sequelize, Sequelize.DataTypes);
  db.SponsorProfile = SponsorProfileModel(sequelize, Sequelize.DataTypes);
  db.Appointment = AppointmentModel(sequelize, Sequelize.DataTypes);
  db.LicenceApplication = LicenceApplicationModel(sequelize, Sequelize.DataTypes);
  db.LicenceApplicationAudit = LicenceApplicationAuditModel(sequelize, Sequelize.DataTypes);
  db.LicenceStageTask = LicenceStageTaskModel(sequelize, Sequelize.DataTypes);
  db.LicenceApplicationRoute = LicenceApplicationRouteModel(sequelize, Sequelize.DataTypes);
  db.LicenceOrganisationInfo = LicenceOrganisationInfoModel(sequelize, Sequelize.DataTypes);
  db.LicenceCosRequirement = LicenceCosRequirementModel(sequelize, Sequelize.DataTypes);
  db.LicenceAppendixDocument = LicenceAppendixDocumentModel(sequelize, Sequelize.DataTypes);
  db.LicenceAuthorisingOfficer = LicenceAuthorisingOfficerModel(sequelize, Sequelize.DataTypes);
  db.LicenceKeyContact = LicenceKeyContactModel(sequelize, Sequelize.DataTypes);
  db.LicenceLevel1User = LicenceLevel1UserModel(sequelize, Sequelize.DataTypes);
  db.LicenceDeclaration = LicenceDeclarationModel(sequelize, Sequelize.DataTypes);
  db.LicenceGovernmentTracking = LicenceGovernmentTrackingModel(sequelize, Sequelize.DataTypes);
  db.CosRequest = CosRequestModel(sequelize, Sequelize.DataTypes);
  db.ComplianceReviewHistory = ComplianceReviewHistoryModel(sequelize, Sequelize.DataTypes);
  db.CalendarMeeting = CalendarMeetingModel(sequelize, Sequelize.DataTypes);
  db.SponsorUserPreference = SponsorUserPreferenceModel(sequelize, Sequelize.DataTypes);
  db.WorkerEvent = WorkerEventModel(sequelize, Sequelize.DataTypes);
  db.SponsorChangeRequest = SponsorChangeRequestModel(sequelize, Sequelize.DataTypes);
  db.RightToWorkRecord = RightToWorkRecordModel(sequelize, Sequelize.DataTypes);
  db.AbsenceRecord = AbsenceRecordModel(sequelize, Sequelize.DataTypes);
  db.SmsActivityLog = SmsActivityLogModel(sequelize, Sequelize.DataTypes);
  db.ComplianceDocument = ComplianceDocumentModel(sequelize, Sequelize.DataTypes);
  db.ComplianceDocumentAudit = ComplianceDocumentAuditModel(sequelize, Sequelize.DataTypes);
  db.CalendarConnection = CalendarConnectionModel(sequelize, Sequelize.DataTypes);
  db.ChangeRequest = ChangeRequestModel(sequelize, Sequelize.DataTypes);
  db.ChangeRequestHistory = ChangeRequestHistoryModel(sequelize, Sequelize.DataTypes);
  db.IntegrationSyncLog = IntegrationSyncLogModel(sequelize, Sequelize.DataTypes);
  db.MeetingIntegration = MeetingIntegrationModel(sequelize, Sequelize.DataTypes);
  db.IntegrationRetryQueue = IntegrationRetryQueueModel(sequelize, Sequelize.DataTypes);
  db.LicenceIntakeForm = LicenceIntakeFormModel(sequelize);
  db.LicenceIntakeDocument = LicenceIntakeDocumentModel(sequelize);
  db.LicenceInformationRequest = LicenceInformationRequestModel(sequelize, Sequelize.DataTypes);
  db.LicenceInformationRequestComment = LicenceInformationRequestCommentModel(sequelize, Sequelize.DataTypes);
  db.LicenceGrantRecord = LicenceGrantRecordModel(sequelize, Sequelize.DataTypes);
  db.CosAllocationRecord = CosAllocationRecordModel(sequelize, Sequelize.DataTypes);
  db.SponsoredWorker = SponsoredWorkerModel(sequelize, Sequelize.DataTypes);
  db.SponsoredWorkerAudit = SponsoredWorkerAuditModel(sequelize, Sequelize.DataTypes);

  // Associations (Same as before)
  db.Conversation.belongsTo(db.User, { foreignKey: "participantOneId", as: "participantOne" });
  db.Conversation.belongsTo(db.User, { foreignKey: "participantTwoId", as: "participantTwo" });
  db.Conversation.belongsTo(db.Case, { foreignKey: "caseId", as: "case" });
  db.Conversation.hasMany(db.Message, { foreignKey: "conversationId", as: "messages" });
  db.Message.belongsTo(db.Conversation, { foreignKey: "conversationId", as: "conversation" });
  db.Role.hasMany(db.User, { foreignKey: "role_id", as: "users" });
  db.User.belongsTo(db.Role, { foreignKey: "role_id", as: "role" });
  db.Role.hasMany(db.UnverifiedUser, { foreignKey: "role_id" });
  db.UnverifiedUser.belongsTo(db.Role, { foreignKey: "role_id" });
  db.User.hasOne(db.CaseworkerProfile, { foreignKey: "user_id", as: "caseworkerProfile" });
  db.CaseworkerProfile.belongsTo(db.User, { foreignKey: "user_id" });
  db.User.hasOne(db.AdminUserPreference, { foreignKey: "user_id", as: "adminPreferences" });
  db.AdminUserPreference.belongsTo(db.User, { foreignKey: "user_id" });
  db.Case.belongsTo(db.User, { foreignKey: "candidateId", as: "candidate" });
  db.Case.belongsTo(db.User, { foreignKey: "sponsorId", as: "sponsor" });
  db.Case.belongsTo(db.VisaType, { foreignKey: "visaTypeId", as: "visaType" });
  db.Case.hasOne(db.CandidateApplication, { foreignKey: "userId", sourceKey: "candidateId", as: "application" });
  db.Case.belongsTo(db.PetitionType, { foreignKey: "petitionTypeId", as: "petitionType" });
  db.Case.belongsTo(db.Department, { foreignKey: "departmentId", as: "department" });
  db.Department.hasMany(db.Case, { foreignKey: "departmentId", as: "cases" });
  db.User.hasMany(db.Case, { foreignKey: "candidateId", as: "cases" });
  db.Case.hasMany(db.Document, { foreignKey: "caseId", as: "documents" });
  db.Case.hasMany(db.CasePayment, { foreignKey: "caseId", as: "payments" });
  db.Case.hasMany(db.CaseTimeline, { foreignKey: "caseId", as: "timeline" });
  db.Case.hasMany(db.CaseCommunication, { foreignKey: "caseId", as: "communications" });
  db.Case.hasMany(db.CaseNote, { foreignKey: "caseId", as: "caseNotes" });
  db.Document.belongsTo(db.User, { foreignKey: "userId", as: "user" });
  db.Document.belongsTo(db.User, { foreignKey: "uploadedBy", as: "uploader" });
  db.Document.belongsTo(db.User, { foreignKey: "reviewedBy", as: "reviewer" });
  db.Document.belongsTo(db.Case, { foreignKey: "caseId", as: "case" });
  db.User.hasMany(db.Document, { foreignKey: "userId", as: "documents" });
  db.User.hasMany(db.Document, { foreignKey: "uploadedBy", as: "uploadedDocuments" });
  db.User.hasMany(db.Document, { foreignKey: "reviewedBy", as: "reviewedDocuments" });
  db.Message.belongsTo(db.User, { foreignKey: "senderId", as: "sender" });
  db.Message.belongsTo(db.User, { foreignKey: "receiverId", as: "receiver" });
  db.User.hasMany(db.Message, { foreignKey: "senderId", as: "sentMessages" });
  db.User.hasMany(db.Message, { foreignKey: "receiverId", as: "receivedMessages" });
  db.CasePayment.belongsTo(db.Case, { foreignKey: "caseId" });
  db.CasePayment.belongsTo(db.User, { foreignKey: "receivedBy", as: "receiver" });
  db.CaseTimeline.belongsTo(db.Case, { foreignKey: "caseId", as: "case" });
  db.CaseTimeline.belongsTo(db.User, { foreignKey: "performedBy", as: "performer" });
  db.CaseCommunication.belongsTo(db.Case, { foreignKey: "caseId" });
  db.CaseCommunication.belongsTo(db.User, { foreignKey: "senderId", as: "sender" });
  db.CaseCommunication.belongsTo(db.User, { foreignKey: "recipientId", as: "recipient" });
  db.CaseNote.belongsTo(db.Case, { foreignKey: "caseId", as: "case" });
  db.CaseNote.belongsTo(db.User, { foreignKey: "authorId", as: "author" });
  db.CaseNote.belongsTo(db.CaseNote, { foreignKey: "parentNoteId", as: "parentNote" });
  db.Task.belongsTo(db.User, { foreignKey: "assigned_to", as: "assignee" });
  db.Task.belongsTo(db.User, { foreignKey: "created_by", as: "creator" });
  db.Task.belongsTo(db.Case, { foreignKey: "case_id", as: "case" });
  db.User.hasMany(db.Task, { foreignKey: "assigned_to", as: "assignedTasks" });
  db.User.hasMany(db.Task, { foreignKey: "created_by", as: "createdTasks" });
  db.Case.hasMany(db.Task, { foreignKey: "case_id", as: "tasks" });
  db.Escalation.belongsTo(db.User, { foreignKey: "assignedAdminId", as: "assignedAdmin" });
  db.User.hasMany(db.Escalation, { foreignKey: "assignedAdminId", as: "assignedEscalations" });
  db.Escalation.belongsTo(db.Case, { foreignKey: "relatedCaseId", as: "relatedCase" });
  db.Case.hasMany(db.Escalation, { foreignKey: "relatedCaseId", as: "escalations" });
  db.RescheduleHistory.belongsTo(db.Case, { foreignKey: "caseId", as: "case" });
  db.RescheduleHistory.belongsTo(db.User, { foreignKey: "createdById", as: "createdBy" });
  db.Case.hasMany(db.RescheduleHistory, { foreignKey: "caseId", as: "rescheduleHistory" });
  db.User.hasMany(db.RescheduleHistory, { foreignKey: "createdById", as: "rescheduleHistory" });
  db.Role.belongsToMany(db.Permission, { through: db.RolePermission, foreignKey: "role_id", otherKey: "permission_id", as: "permissions" });
  db.Permission.belongsToMany(db.Role, { through: db.RolePermission, foreignKey: "permission_id", otherKey: "role_id", as: "roles" });
  db.Notification.belongsTo(db.User, { foreignKey: "userId", as: "user" });
  db.Notification.belongsTo(db.Role, { foreignKey: "roleId", as: "role" });
  db.User.hasMany(db.Notification, { foreignKey: "userId", as: "notifications" });
  db.Role.hasMany(db.Notification, { foreignKey: "roleId", as: "notifications" });
  db.NotificationPreference.belongsTo(db.User, { foreignKey: "userId", as: "user" });
  db.User.hasOne(db.NotificationPreference, { foreignKey: "userId", as: "notificationPreference" });
  db.User.hasOne(db.CandidateAccountSettings, { foreignKey: "user_id", as: "candidateAccountSettings" });
  db.CandidateAccountSettings.belongsTo(db.User, { foreignKey: "user_id", as: "user" });
  db.User.hasMany(db.CandidateFeedback, { foreignKey: "user_id", as: "candidateFeedbacks" });
  db.CandidateFeedback.belongsTo(db.User, { foreignKey: "user_id", as: "user" });
  db.CandidateFeedback.belongsTo(db.Case, { foreignKey: "case_id", as: "case" });
  db.Case.hasMany(db.CandidateFeedback, { foreignKey: "case_id", as: "feedbacks" });
  db.User.hasMany(db.CandidateIssueReport, { foreignKey: "user_id", as: "candidateIssueReports" });
  db.CandidateIssueReport.belongsTo(db.User, { foreignKey: "user_id", as: "user" });
  db.CandidateIssueReport.belongsTo(db.Case, { foreignKey: "case_id", as: "case" });
  db.Case.hasMany(db.CandidateIssueReport, { foreignKey: "case_id", as: "issueReports" });
  db.User.hasOne(db.CandidateApplication, { foreignKey: "userId", as: "application" });
  db.CandidateApplication.belongsTo(db.User, { foreignKey: "userId", as: "user" });
  db.User.hasOne(db.SponsorProfile, { foreignKey: "userId", as: "sponsorProfile" });
  db.SponsorProfile.belongsTo(db.User, { foreignKey: "userId", as: "user" });
  db.User.hasOne(db.SponsorUserPreference, { foreignKey: "userId", as: "sponsorPreferences" });
  db.SponsorUserPreference.belongsTo(db.User, { foreignKey: "userId", as: "user" });
  db.WorkerEvent.belongsTo(db.User, { foreignKey: "workerId", as: "worker" });
  db.WorkerEvent.belongsTo(db.User, { foreignKey: "sponsorId", as: "sponsor" });
  db.WorkerEvent.belongsTo(db.User, { foreignKey: "reviewedBy", as: "reviewer" });
  db.WorkerEvent.belongsTo(db.Case, { foreignKey: "caseId", as: "case" });
  db.WorkerEvent.belongsTo(db.Organisation, { foreignKey: "organisationId", as: "organisation" });
  db.User.hasMany(db.WorkerEvent, { foreignKey: "workerId", as: "workerEvents" });
  db.User.hasMany(db.WorkerEvent, { foreignKey: "sponsorId", as: "sponsorWorkerEvents" });
  db.Case.hasMany(db.WorkerEvent, { foreignKey: "caseId", as: "workerEvents" });
  db.Organisation.hasMany(db.WorkerEvent, { foreignKey: "organisationId", as: "workerEvents" });
  db.Appointment.belongsTo(db.User, { foreignKey: "candidate_id", as: "candidate" });
  db.Appointment.belongsTo(db.User, { foreignKey: "caseworker_id", as: "caseworker" });
  db.Appointment.belongsTo(db.Case, { foreignKey: "case_id", as: "case" });
  db.User.hasMany(db.Appointment, { foreignKey: "candidate_id", as: "candidateAppointments" });
  db.User.hasMany(db.Appointment, { foreignKey: "caseworker_id", as: "caseworkerAppointments" });
  db.Case.hasMany(db.Appointment, { foreignKey: "case_id", as: "appointments" });
  db.User.hasMany(db.LicenceApplication, { foreignKey: "userId", as: "licenceApplications" });
  db.LicenceApplication.belongsTo(db.User, { foreignKey: "userId", as: "user" });
  db.LicenceApplication.belongsTo(db.Organisation, { foreignKey: "organisationId", as: "organisation" });
  db.Organisation.hasMany(db.LicenceApplication, { foreignKey: "organisationId", as: "licenceApplications" });

  db.LicenceApplication.hasMany(db.LicenceApplicationAudit, { foreignKey: "licenceApplicationId", as: "auditTrail" });
  db.LicenceApplicationAudit.belongsTo(db.LicenceApplication, { foreignKey: "licenceApplicationId", as: "application" });
  db.LicenceApplicationAudit.belongsTo(db.User, { foreignKey: "actorId", as: "actor" });
  db.LicenceApplicationAudit.belongsTo(db.Organisation, { foreignKey: "organisationId", as: "organisation" });

  // Per-stage, per-role tasks (the interactive stages panel engine).
  db.LicenceApplication.hasMany(db.LicenceStageTask, { foreignKey: "licenceApplicationId", as: "stageTasks" });
  db.LicenceStageTask.belongsTo(db.LicenceApplication, { foreignKey: "licenceApplicationId", as: "application" });
  db.LicenceStageTask.belongsTo(db.User, { foreignKey: "assignedToUserId", as: "assignee" });
  db.LicenceStageTask.belongsTo(db.User, { foreignKey: "completedByUserId", as: "completedBy" });
  db.User.hasMany(db.LicenceStageTask, { foreignKey: "assignedToUserId", as: "licenceStageTasks" });

  // Sponsor Licence Application V2 — section + child associations (one parent row).
  db.LicenceApplication.hasMany(db.LicenceApplicationRoute, { foreignKey: "licenceApplicationId", as: "routes" });
  db.LicenceApplicationRoute.belongsTo(db.LicenceApplication, { foreignKey: "licenceApplicationId", as: "application" });
  db.LicenceApplication.hasOne(db.LicenceOrganisationInfo, { foreignKey: "licenceApplicationId", as: "organisationInfo" });
  db.LicenceOrganisationInfo.belongsTo(db.LicenceApplication, { foreignKey: "licenceApplicationId", as: "application" });
  db.LicenceApplication.hasMany(db.LicenceCosRequirement, { foreignKey: "licenceApplicationId", as: "cosRequirements" });
  db.LicenceCosRequirement.belongsTo(db.LicenceApplication, { foreignKey: "licenceApplicationId", as: "application" });
  db.LicenceApplication.hasMany(db.LicenceAppendixDocument, { foreignKey: "licenceApplicationId", as: "appendixDocuments" });
  db.LicenceAppendixDocument.belongsTo(db.LicenceApplication, { foreignKey: "licenceApplicationId", as: "application" });
  db.LicenceAppendixDocument.belongsTo(db.User, { foreignKey: "verifiedBy", as: "verifier" });
  db.LicenceApplication.hasOne(db.LicenceAuthorisingOfficer, { foreignKey: "licenceApplicationId", as: "authorisingOfficer" });
  db.LicenceAuthorisingOfficer.belongsTo(db.LicenceApplication, { foreignKey: "licenceApplicationId", as: "application" });
  db.LicenceApplication.hasOne(db.LicenceKeyContact, { foreignKey: "licenceApplicationId", as: "keyContact" });
  db.LicenceKeyContact.belongsTo(db.LicenceApplication, { foreignKey: "licenceApplicationId", as: "application" });
  db.LicenceApplication.hasMany(db.LicenceLevel1User, { foreignKey: "licenceApplicationId", as: "level1Users" });
  db.LicenceLevel1User.belongsTo(db.LicenceApplication, { foreignKey: "licenceApplicationId", as: "application" });
  db.LicenceApplication.hasOne(db.LicenceDeclaration, { foreignKey: "licenceApplicationId", as: "declaration" });
  db.LicenceDeclaration.belongsTo(db.LicenceApplication, { foreignKey: "licenceApplicationId", as: "application" });

  // Phase 1 — government processing tracking (1:1 with licence_applications).
  db.LicenceApplication.hasOne(db.LicenceGovernmentTracking, { foreignKey: "licenceApplicationId", as: "governmentTracking" });
  db.LicenceGovernmentTracking.belongsTo(db.LicenceApplication, { foreignKey: "licenceApplicationId", as: "application" });
  db.LicenceApplicationRoute.belongsTo(db.Organisation, { foreignKey: "organisationId", as: "organisation" });
  db.LicenceOrganisationInfo.belongsTo(db.Organisation, { foreignKey: "organisationId", as: "organisation" });
  db.LicenceCosRequirement.belongsTo(db.Organisation, { foreignKey: "organisationId", as: "organisation" });
  db.LicenceAppendixDocument.belongsTo(db.Organisation, { foreignKey: "organisationId", as: "organisation" });
  db.LicenceAuthorisingOfficer.belongsTo(db.Organisation, { foreignKey: "organisationId", as: "organisation" });
  db.LicenceKeyContact.belongsTo(db.Organisation, { foreignKey: "organisationId", as: "organisation" });
  db.LicenceLevel1User.belongsTo(db.Organisation, { foreignKey: "organisationId", as: "organisation" });
  db.LicenceDeclaration.belongsTo(db.Organisation, { foreignKey: "organisationId", as: "organisation" });

  db.CosRequest.belongsTo(db.User, { foreignKey: "sponsorId", as: "sponsor" });
  db.CosRequest.belongsTo(db.User, { foreignKey: "reviewedBy", as: "reviewer" });
  db.CosRequest.belongsTo(db.Organisation, { foreignKey: "organisationId", as: "organisation" });
  db.User.hasMany(db.CosRequest, { foreignKey: "sponsorId", as: "cosRequests" });

  // CoS Allocation Records — 1:1 with an approved CoS request.
  db.CosRequest.hasOne(db.CosAllocationRecord, { foreignKey: "cosRequestId", as: "allocationRecord" });
  db.CosAllocationRecord.belongsTo(db.CosRequest, { foreignKey: "cosRequestId", as: "cosRequest" });
  db.CosAllocationRecord.belongsTo(db.User, { foreignKey: "sponsorId", as: "sponsor" });
  db.CosAllocationRecord.belongsTo(db.User, { foreignKey: "allocatedById", as: "allocatedBy" });
  db.CosAllocationRecord.belongsTo(db.Organisation, { foreignKey: "organisationId", as: "organisation" });
  db.CalendarMeeting.belongsTo(db.User, { foreignKey: "user_id", as: "user" });
  db.User.hasMany(db.CalendarMeeting, { foreignKey: "user_id", as: "calendarMeetings" });
  db.CalendarConnection.belongsTo(db.User, { foreignKey: "user_id", as: "user" });
  db.User.hasMany(db.CalendarConnection, { foreignKey: "user_id", as: "calendarConnections" });
  db.Organisation.hasMany(db.User, { foreignKey: "organisation_id", as: "users" });
  db.User.belongsTo(db.Organisation, { foreignKey: "organisation_id", as: "organisation" });
  db.Organisation.hasMany(db.Case, { foreignKey: "organisation_id", as: "cases" });
  db.Case.belongsTo(db.Organisation, { foreignKey: "organisation_id", as: "organisation" });
  db.Organisation.hasMany(db.SponsorProfile, { foreignKey: "organisation_id", as: "sponsors" });
  db.SponsorProfile.belongsTo(db.Organisation, { foreignKey: "organisation_id", as: "organisation" });
  db.Organisation.hasMany(db.AuditLog, { foreignKey: "organisation_id", as: "auditLogs" });
  db.AuditLog.belongsTo(db.Organisation, { foreignKey: "organisation_id", as: "organisation" });
  db.Organisation.hasMany(db.CandidateApplication, { foreignKey: "organisation_id", as: "candidateApplications" });
  db.CandidateApplication.belongsTo(db.Organisation, { foreignKey: "organisation_id", as: "organisation" });
  db.User.hasMany(db.AuditLog, { foreignKey: "user_id", as: "auditLogs" });
  db.AuditLog.belongsTo(db.User, { foreignKey: "user_id", as: "user" });
  db.VisaType.hasMany(db.DocumentChecklist, { foreignKey: "visaTypeId", as: "documentChecklists" });
  db.DocumentChecklist.belongsTo(db.VisaType, { foreignKey: "visaTypeId", as: "visaType" });
  db.Case.hasMany(db.DocumentChecklist, { foreignKey: "caseId", as: "documentChecklists" });
  db.DocumentChecklist.belongsTo(db.Case, { foreignKey: "caseId", as: "case" });
  db.DataCaptureTemplate.belongsTo(db.VisaType, { foreignKey: "visaTypeId", as: "visaType" });
  db.VisaType.hasMany(db.DataCaptureTemplate, { foreignKey: "visaTypeId", as: "dataCaptureTemplates" });
  db.CclTemplate.belongsTo(db.VisaType, { foreignKey: "visaTypeId", as: "visaType" });
  db.VisaType.hasMany(db.CclTemplate, { foreignKey: "visaTypeId", as: "cclTemplates" });
  db.DataCaptureSubmission.belongsTo(db.Case, { foreignKey: "caseId", as: "case" });
  db.DataCaptureSubmission.belongsTo(db.User, { foreignKey: "userId", as: "user" });
  db.DataCaptureSubmission.belongsTo(db.DataCaptureTemplate, { foreignKey: "templateId", as: "template" });
  db.Case.hasOne(db.DataCaptureSubmission, { foreignKey: "caseId", as: "dataCaptureSubmission" });
  db.Case.hasOne(db.CaseCclRecord, { foreignKey: "caseId", as: "cclRecord" });
  db.CaseCclRecord.belongsTo(db.Case, { foreignKey: "caseId", as: "case" });

  db.SponsorChangeRequest.belongsTo(db.User, { foreignKey: "sponsorId", as: "sponsor" });
  db.SponsorChangeRequest.belongsTo(db.User, { foreignKey: "requestedBy", as: "requester" });
  db.SponsorChangeRequest.belongsTo(db.User, { foreignKey: "reportedBy", as: "reporter" });
  db.SponsorChangeRequest.belongsTo(db.User, { foreignKey: "reviewedBy", as: "reviewer" });
  db.SponsorChangeRequest.belongsTo(db.Organisation, { foreignKey: "organisationId", as: "organisation" });

  db.ComplianceReviewHistory.belongsTo(db.User, { foreignKey: "actorId", as: "actor" });
  db.ComplianceReviewHistory.belongsTo(db.Organisation, { foreignKey: "organisationId", as: "organisation" });

  db.RightToWorkRecord.belongsTo(db.User, { foreignKey: "workerId", as: "worker" });
  db.RightToWorkRecord.belongsTo(db.User, { foreignKey: "sponsorId", as: "sponsor" });
  db.RightToWorkRecord.belongsTo(db.User, { foreignKey: "checkedBy", as: "checker" });
  db.RightToWorkRecord.belongsTo(db.User, { foreignKey: "reviewedBy", as: "reviewer" });
  db.RightToWorkRecord.belongsTo(db.Organisation, { foreignKey: "organisationId", as: "organisation" });

  db.AbsenceRecord.belongsTo(db.User, { foreignKey: "workerId", as: "worker" });
  db.AbsenceRecord.belongsTo(db.User, { foreignKey: "sponsorId", as: "sponsor" });
  db.AbsenceRecord.belongsTo(db.Organisation, { foreignKey: "organisationId", as: "organisation" });

  db.SmsActivityLog.belongsTo(db.User, { foreignKey: "sponsorId", as: "sponsor" });
  db.SmsActivityLog.belongsTo(db.User, { foreignKey: "submittedBy", as: "submitter" });
  db.SmsActivityLog.belongsTo(db.Organisation, { foreignKey: "organisationId", as: "organisation" });

  db.ComplianceDocument.belongsTo(db.User, { foreignKey: "sponsorId", as: "sponsor" });
  db.ComplianceDocument.belongsTo(db.User, { foreignKey: "reviewedBy", as: "reviewer" });
  db.ComplianceDocument.belongsTo(db.Organisation, { foreignKey: "organisationId", as: "organisation" });

  db.ComplianceDocument.hasMany(db.ComplianceDocumentAudit, { foreignKey: "complianceDocumentId", as: "auditTrail" });
  db.ComplianceDocumentAudit.belongsTo(db.ComplianceDocument, { foreignKey: "complianceDocumentId", as: "document" });
  db.ComplianceDocumentAudit.belongsTo(db.User, { foreignKey: "reviewerId", as: "reviewer" });
  db.ComplianceDocumentAudit.belongsTo(db.Organisation, { foreignKey: "organisationId", as: "organisation" });

  db.ChangeRequest.belongsTo(db.User, { foreignKey: "submitted_by", as: "submitter" });
  db.ChangeRequest.belongsTo(db.User, { foreignKey: "reviewed_by", as: "reviewer" });
  db.ChangeRequest.belongsTo(db.Case, { foreignKey: "case_id", as: "case" });
  db.ChangeRequest.belongsTo(db.Organisation, { foreignKey: "organisation_id", as: "organisation" });
  db.ChangeRequest.hasMany(db.ChangeRequestHistory, { foreignKey: "change_request_id", as: "history" });
  db.ChangeRequestHistory.belongsTo(db.ChangeRequest, { foreignKey: "change_request_id", as: "changeRequest" });
  db.ChangeRequestHistory.belongsTo(db.User, { foreignKey: "performed_by", as: "performer" });

  db.IntegrationSyncLog.belongsTo(db.User, { foreignKey: "user_id", as: "user" });
  db.User.hasMany(db.IntegrationSyncLog, { foreignKey: "user_id", as: "syncLogs" });

  db.MeetingIntegration.belongsTo(db.Appointment, { foreignKey: "appointment_id", as: "appointment" });
  db.Appointment.hasMany(db.MeetingIntegration, { foreignKey: "appointment_id", as: "integrations" });

  db.IntegrationRetryQueue.belongsTo(db.User, { foreignKey: "user_id", as: "user" });

  // Licence Intake — information form + document checklist (1:1 and 1:M with licence_applications).
  db.LicenceApplication.hasOne(db.LicenceIntakeForm, { foreignKey: "licenceApplicationId", as: "intakeForm" });
  db.LicenceIntakeForm.belongsTo(db.LicenceApplication, { foreignKey: "licenceApplicationId", as: "application" });
  db.LicenceApplication.hasMany(db.LicenceIntakeDocument, { foreignKey: "licenceApplicationId", as: "intakeDocuments" });
  db.LicenceIntakeDocument.belongsTo(db.LicenceApplication, { foreignKey: "licenceApplicationId", as: "application" });
  db.LicenceIntakeDocument.belongsTo(db.User, { foreignKey: "uploadedByUserId", as: "uploader" });
  db.LicenceIntakeDocument.belongsTo(db.User, { foreignKey: "verifiedByUserId", as: "verifier" });

  // Licence Grant Record — 1:1 with the application (created on grant).
  db.LicenceApplication.hasOne(db.LicenceGrantRecord, { foreignKey: "licenceApplicationId", as: "grantRecord" });
  db.LicenceGrantRecord.belongsTo(db.LicenceApplication, { foreignKey: "licenceApplicationId", as: "application" });
  db.LicenceGrantRecord.belongsTo(db.User, { foreignKey: "approvedById", as: "approvedBy" });

  // Information Request workflow (1:M application → requests; 1:M request → comments).
  db.LicenceApplication.hasMany(db.LicenceInformationRequest, { foreignKey: "licenceApplicationId", as: "infoRequests" });
  db.LicenceInformationRequest.belongsTo(db.LicenceApplication, { foreignKey: "licenceApplicationId", as: "application" });
  db.LicenceInformationRequest.belongsTo(db.User, { foreignKey: "requestedById", as: "requestedBy" });
  db.LicenceInformationRequest.belongsTo(db.User, { foreignKey: "resolvedById", as: "resolvedBy" });
  db.LicenceInformationRequest.hasMany(db.LicenceInformationRequestComment, { foreignKey: "licenceInformationRequestId", as: "comments" });
  db.LicenceInformationRequestComment.belongsTo(db.LicenceInformationRequest, { foreignKey: "licenceInformationRequestId", as: "infoRequest" });
  db.LicenceInformationRequestComment.belongsTo(db.User, { foreignKey: "authorId", as: "author" });

  // Phase 5 — Sponsored Worker Management.
  db.SponsoredWorker.belongsTo(db.User, { foreignKey: "sponsorId", as: "sponsor" });
  db.SponsoredWorker.belongsTo(db.Organisation, { foreignKey: "organisationId", as: "organisation" });
  db.SponsoredWorker.belongsTo(db.CosRequest, { foreignKey: "cosRequestId", as: "cosRequest" });
  db.SponsoredWorker.belongsTo(db.CosAllocationRecord, { foreignKey: "cosAllocationRecordId", as: "cosAllocationRecord" });
  db.SponsoredWorker.hasMany(db.SponsoredWorkerAudit, { foreignKey: "sponsoredWorkerId", as: "auditTrail" });
  db.SponsoredWorkerAudit.belongsTo(db.SponsoredWorker, { foreignKey: "sponsoredWorkerId", as: "worker" });
  db.SponsoredWorkerAudit.belongsTo(db.User, { foreignKey: "actorId", as: "actor" });
  db.User.hasMany(db.SponsoredWorker, { foreignKey: "sponsorId", as: "sponsoredWorkers" });
  db.CosRequest.hasMany(db.SponsoredWorker, { foreignKey: "cosRequestId", as: "sponsoredWorkers" });
  db.CosAllocationRecord.hasMany(db.SponsoredWorker, { foreignKey: "cosAllocationRecordId", as: "sponsoredWorkers" });

  return db;
}
