import { Sequelize } from "sequelize";
import config from "../config/config.js";
import OrganisationModel from "./platform/organisation.model.js";
import UserModel from "./platform/user.model.js";
import PlanModel from "./platform/plan.model.js";
import RoleModel from "./tenant/role.model.js";
import PermissionModel from "./tenant/permission.model.js";
import RolePermissionModel from "./tenant/rolePermission.model.js";

const env = process.env.NODE_ENV || "development";
const c = config[env];

const sequelize = new Sequelize(c.database, c.username, c.password, {
  host: c.host,
  port: c.port,
  dialect: c.dialect || "postgres",
  logging: c.logging ?? false,
  ...(c.dialectOptions ? { dialectOptions: c.dialectOptions } : {}),
});

const db = {
  sequelize,
  Sequelize,
};

// Global Registry Models
db.Organisation = OrganisationModel(sequelize, Sequelize.DataTypes);
db.User = UserModel(sequelize, Sequelize.DataTypes);
db.Plan = PlanModel(sequelize, Sequelize.DataTypes);
db.Role = RoleModel(sequelize, Sequelize.DataTypes);
db.Permission = PermissionModel(sequelize, Sequelize.DataTypes);
db.RolePermission = RolePermissionModel(sequelize, Sequelize.DataTypes);

// Associations for Platform Level
db.Organisation.hasMany(db.User, { foreignKey: "organisation_id", as: "users" });
db.User.belongsTo(db.Organisation, { foreignKey: "organisation_id", as: "organisation" });

db.Plan.hasMany(db.Organisation, { foreignKey: "plan_id", as: "organisations" });
db.Organisation.belongsTo(db.Plan, { foreignKey: "plan_id", as: "plan" });

// Role & Permission associations for Platform
db.Role.hasMany(db.User, { foreignKey: "role_id", as: "users" });
db.User.belongsTo(db.Role, { foreignKey: "role_id", as: "role" });

db.Role.belongsToMany(db.Permission, {
  through: db.RolePermission,
  foreignKey: "role_id",
  as: "permissions",
});
db.Permission.belongsToMany(db.Role, {
  through: db.RolePermission,
  foreignKey: "permission_id",
  as: "roles",
});

export default db;
