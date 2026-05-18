import { Sequelize } from "sequelize";
import config from "../config/config.js";
import OrganisationModel from "./platform/organisation.model.js";
import UserModel from "./platform/user.model.js";
import PlanModel from "./platform/plan.model.js";
import SubscriptionModel from "./platform/subscription.model.js";
import InvoiceModel from "./platform/invoice.model.js";
import PaymentTransactionModel from "./platform/paymentTransaction.model.js";
import ModuleModel from "./platform/module.model.js";
import PlanModuleModel from "./platform/planModule.model.js";
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
  ...(c.pool ? { pool: c.pool } : {}),
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
db.Subscription = SubscriptionModel(sequelize, Sequelize.DataTypes);
db.Invoice = InvoiceModel(sequelize, Sequelize.DataTypes);
db.PaymentTransaction = PaymentTransactionModel(sequelize, Sequelize.DataTypes);
db.Module = ModuleModel(sequelize, Sequelize.DataTypes);
db.PlanModule = PlanModuleModel(sequelize, Sequelize.DataTypes);
db.Role = RoleModel(sequelize, Sequelize.DataTypes);
db.Permission = PermissionModel(sequelize, Sequelize.DataTypes);
db.RolePermission = RolePermissionModel(sequelize, Sequelize.DataTypes);

// Associations for Platform Level
db.Organisation.hasMany(db.User, { foreignKey: "organisation_id", as: "users" });
db.User.belongsTo(db.Organisation, { foreignKey: "organisation_id", as: "organisation" });

db.Plan.hasMany(db.Organisation, { foreignKey: "plan_id", as: "organisations" });
db.Organisation.belongsTo(db.Plan, { foreignKey: "plan_id", as: "plan" });

db.Organisation.hasMany(db.Subscription, { foreignKey: "organisation_id", as: "subscriptions" });
db.Subscription.belongsTo(db.Organisation, { foreignKey: "organisation_id", as: "organisation" });

db.Plan.hasMany(db.Subscription, { foreignKey: "plan_id", as: "subscriptions" });
db.Subscription.belongsTo(db.Plan, { foreignKey: "plan_id", as: "plan" });

db.Subscription.hasMany(db.Invoice, { foreignKey: "subscription_id", as: "invoices" });
db.Invoice.belongsTo(db.Subscription, { foreignKey: "subscription_id", as: "subscription" });

db.Organisation.hasMany(db.Invoice, { foreignKey: "organisation_id", as: "invoices" });
db.Invoice.belongsTo(db.Organisation, { foreignKey: "organisation_id", as: "organisation" });

db.Invoice.hasMany(db.PaymentTransaction, { foreignKey: "invoice_id", as: "transactions" });
db.PaymentTransaction.belongsTo(db.Invoice, { foreignKey: "invoice_id", as: "invoice" });

db.Organisation.hasMany(db.PaymentTransaction, { foreignKey: "organisation_id", as: "transactions" });
db.PaymentTransaction.belongsTo(db.Organisation, { foreignKey: "organisation_id", as: "organisation" });

db.Plan.hasMany(db.PlanModule, { foreignKey: "plan_id", as: "planModules" });
db.PlanModule.belongsTo(db.Plan, { foreignKey: "plan_id", as: "plan" });
db.PlanModule.belongsTo(db.Module, { foreignKey: "module_id", as: "module" });
db.Module.hasMany(db.PlanModule, { foreignKey: "module_id", as: "planModules" });

db.Plan.belongsToMany(db.Module, { through: db.PlanModule, foreignKey: "plan_id", otherKey: "module_id", as: "modules" });
db.Module.belongsToMany(db.Plan, { through: db.PlanModule, foreignKey: "module_id", otherKey: "plan_id", as: "plans" });

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
