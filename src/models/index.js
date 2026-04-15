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

export default db;