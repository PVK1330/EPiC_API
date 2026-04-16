import { Sequelize } from 'sequelize';

import config from '../config/config.js';

import UserModel from './user.model.js';

import RoleModel from './role.model.js';

import UnverifiedUserModel from './unverifiedUser.model.js';

import CaseModel from './case.model.js';

import CaseworkerProfileModel from './caseworkerProfile.model.js';

import AdminUserPreferenceModel from './adminUserPreference.model.js';

import VisaTypeModel from './visaType.model.js';

import PetitionTypeModel from './petitionType.model.js';

import CaseCategoryModel from './caseCategory.model.js';

import EmailTemplateSettingModel from './emailTemplateSetting.model.js';

import SlaSettingModel from './slaSetting.model.js';
import EscalationModel from './escalation.model.js';
import PermissionModel from './permission.model.js';
import RolePermissionModel from './rolePermission.model.js';

import DocumentModel from './document.model.js';

import CasePaymentModel from './casePayment.model.js';

import CaseTimelineModel from './caseTimeline.model.js';

import CaseCommunicationModel from './caseCommunication.model.js';

import CaseNoteModel from './caseNote.model.js';

import TaskModel from './task.model.js';



const env = process.env.NODE_ENV || 'development';

const dbConfig = config[env];



const sequelize = new Sequelize(dbConfig.database, dbConfig.username, dbConfig.password, dbConfig);



const db = {};

db.Sequelize = Sequelize;

db.sequelize = sequelize;

db.User = UserModel(sequelize, Sequelize.DataTypes);

db.Role = RoleModel(sequelize, Sequelize.DataTypes);

db.UnverifiedUser = UnverifiedUserModel(sequelize, Sequelize.DataTypes);

db.Case = CaseModel(sequelize, Sequelize.DataTypes);

db.CaseworkerProfile = CaseworkerProfileModel(sequelize, Sequelize.DataTypes);

db.AdminUserPreference = AdminUserPreferenceModel(sequelize, Sequelize.DataTypes);

db.VisaType = VisaTypeModel(sequelize, Sequelize.DataTypes);

db.PetitionType = PetitionTypeModel(sequelize, Sequelize.DataTypes);

db.CaseCategory = CaseCategoryModel(sequelize, Sequelize.DataTypes);

db.EmailTemplateSetting = EmailTemplateSettingModel(sequelize, Sequelize.DataTypes);

db.SlaSetting = SlaSettingModel(sequelize, Sequelize.DataTypes);
db.Escalation = EscalationModel(sequelize, Sequelize.DataTypes);
db.Permission = PermissionModel(sequelize, Sequelize.DataTypes);
db.RolePermission = RolePermissionModel(sequelize, Sequelize.DataTypes);

db.Document = DocumentModel(sequelize, Sequelize.DataTypes);

db.CasePayment = CasePaymentModel(sequelize, Sequelize.DataTypes);

db.CaseTimeline = CaseTimelineModel(sequelize, Sequelize.DataTypes);

db.CaseCommunication = CaseCommunicationModel(sequelize, Sequelize.DataTypes);

db.CaseNote = CaseNoteModel(sequelize, Sequelize.DataTypes);

db.Task = TaskModel(sequelize, Sequelize.DataTypes);



// Associations

db.Role.hasMany(db.User, { foreignKey: 'role_id' });

db.User.belongsTo(db.Role, { foreignKey: 'role_id' });



db.Role.hasMany(db.UnverifiedUser, { foreignKey: 'role_id' });

db.UnverifiedUser.belongsTo(db.Role, { foreignKey: 'role_id' });



db.User.hasOne(db.CaseworkerProfile, { foreignKey: 'user_id', as: 'caseworkerProfile' });

db.CaseworkerProfile.belongsTo(db.User, { foreignKey: 'user_id' });



db.User.hasOne(db.AdminUserPreference, { foreignKey: 'user_id', as: 'adminPreferences' });

db.AdminUserPreference.belongsTo(db.User, { foreignKey: 'user_id' });

// Case associations
db.Case.belongsTo(db.User, { foreignKey: 'candidateId', as: 'candidate' });
db.Case.belongsTo(db.User, { foreignKey: 'sponsorId', as: 'sponsor' });
db.Case.belongsTo(db.VisaType, { foreignKey: 'visaTypeId', as: 'visaType' });
db.Case.belongsTo(db.PetitionType, { foreignKey: 'petitionTypeId', as: 'petitionType' });

// Case has many relationships
db.Case.hasMany(db.Document, { foreignKey: 'caseId', as: 'documents' });
db.Case.hasMany(db.CasePayment, { foreignKey: 'caseId', as: 'payments' });
db.Case.hasMany(db.CaseTimeline, { foreignKey: 'caseId', as: 'timeline' });
db.Case.hasMany(db.CaseCommunication, { foreignKey: 'caseId', as: 'communications' });
db.Case.hasMany(db.CaseNote, { foreignKey: 'caseId', as: 'caseNotes' });

// Document associations
db.Document.belongsTo(db.User, { foreignKey: 'userId', as: 'user' });
db.Document.belongsTo(db.User, { foreignKey: 'uploadedBy', as: 'uploader' });
db.Document.belongsTo(db.User, { foreignKey: 'reviewedBy', as: 'reviewer' });
db.Document.belongsTo(db.Case, { foreignKey: 'caseId', as: 'case' });

// User associations with Documents
db.User.hasMany(db.Document, { foreignKey: 'userId', as: 'documents' });
db.User.hasMany(db.Document, { foreignKey: 'uploadedBy', as: 'uploadedDocuments' });
db.User.hasMany(db.Document, { foreignKey: 'reviewedBy', as: 'reviewedDocuments' });

db.CasePayment.belongsTo(db.Case, { foreignKey: 'caseId' });
db.CasePayment.belongsTo(db.User, { foreignKey: 'receivedBy', as: 'receiver' });

db.CaseTimeline.belongsTo(db.Case, { foreignKey: 'caseId' });
db.CaseTimeline.belongsTo(db.User, { foreignKey: 'performedBy', as: 'performer' });

db.CaseCommunication.belongsTo(db.Case, { foreignKey: 'caseId' });
db.CaseCommunication.belongsTo(db.User, { foreignKey: 'senderId', as: 'sender' });
db.CaseCommunication.belongsTo(db.User, { foreignKey: 'recipientId', as: 'recipient' });

db.CaseNote.belongsTo(db.Case, { foreignKey: 'caseId' });
db.CaseNote.belongsTo(db.User, { foreignKey: 'authorId', as: 'author' });
db.CaseNote.belongsTo(db.CaseNote, { foreignKey: 'parentNoteId', as: 'parentNote' });

// Task associations
db.Task.belongsTo(db.User, { foreignKey: 'assigned_to', as: 'assignee' });
db.Task.belongsTo(db.User, { foreignKey: 'created_by', as: 'creator' });
db.Task.belongsTo(db.Case, { foreignKey: 'case_id' });
db.User.hasMany(db.Task, { foreignKey: 'assigned_to', as: 'assignedTasks' });
db.User.hasMany(db.Task, { foreignKey: 'created_by', as: 'createdTasks' });
db.Case.hasMany(db.Task, { foreignKey: 'case_id', as: 'tasks' });

db.Case.belongsTo(db.User, { foreignKey: 'assignedToId', as: 'assignedTo' });
db.User.hasMany(db.Case, { foreignKey: 'assignedToId', as: 'assignedCases' });

db.Case.belongsTo(db.User, { foreignKey: 'createdById', as: 'createdBy' });
db.User.hasMany(db.Case, { foreignKey: 'createdById', as: 'createdCases' });

// Escalation associations
db.Escalation.belongsTo(db.User, { foreignKey: 'assignedAdminId', as: 'assignedAdmin' });
db.User.hasMany(db.Escalation, { foreignKey: 'assignedAdminId', as: 'assignedEscalations' });

db.Escalation.belongsTo(db.Case, { foreignKey: 'relatedCaseId', as: 'relatedCase' });
db.Case.hasMany(db.Escalation, { foreignKey: 'relatedCaseId', as: 'escalations' });

// Permission associations
db.Role.belongsToMany(db.Permission, { 
  through: db.RolePermission, 
  foreignKey: 'role_id', 
  otherKey: 'permission_id',
  as: 'permissions'
});
db.Permission.belongsToMany(db.Role, { 
  through: db.RolePermission, 
  foreignKey: 'permission_id', 
  otherKey: 'role_id',
  as: 'roles'
});

export default db;