import { Sequelize } from 'sequelize';
import config from '../config/config.js';
import UserModel from './user.model.js';
import RoleModel from './role.model.js';
import UnverifiedUserModel from './unverifiedUser.model.js';
import CaseworkerProfileModel from './caseworkerProfile.model.js';

const env = process.env.NODE_ENV || 'development';
const dbConfig = config[env];

const sequelize = new Sequelize(dbConfig.database, dbConfig.username, dbConfig.password, dbConfig);

const db = {};
db.Sequelize = Sequelize;
db.sequelize = sequelize;
db.User = UserModel(sequelize, Sequelize.DataTypes);
db.Role = RoleModel(sequelize, Sequelize.DataTypes);
db.UnverifiedUser = UnverifiedUserModel(sequelize, Sequelize.DataTypes);
db.CaseworkerProfile = CaseworkerProfileModel(sequelize, Sequelize.DataTypes);

// Associations
db.Role.hasMany(db.User, { foreignKey: 'role_id' });
db.User.belongsTo(db.Role, { foreignKey: 'role_id' });

db.Role.hasMany(db.UnverifiedUser, { foreignKey: 'role_id' });
db.UnverifiedUser.belongsTo(db.Role, { foreignKey: 'role_id' });

db.User.hasOne(db.CaseworkerProfile, { foreignKey: 'user_id', as: 'caseworkerProfile' });
db.CaseworkerProfile.belongsTo(db.User, { foreignKey: 'user_id' });

export default db;