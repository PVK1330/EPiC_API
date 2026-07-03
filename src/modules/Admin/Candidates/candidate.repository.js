import { Op } from 'sequelize';

// SECURITY (BUG-002): never serialise credential / auth-secret columns out of
// the admin candidate endpoints. Exposing the bcrypt hash allows offline
// cracking, and the TOTP secret + reset OTPs allow 2FA bypass / account
// takeover. is_otp_verified / two_factor_enabled / password_changed_at are safe
// booleans/timestamps and are intentionally NOT excluded.
export const SENSITIVE_USER_ATTRS = [
  'password',
  'otp_code',
  'otp_expiry',
  'password_reset_otp',
  'password_reset_otp_expiry',
  'temp_password',
  'two_factor_secret',
  'two_factor_backup_codes',
];

export class CandidateRepository {
  constructor(tenantDb) {
    this.tenantDb = tenantDb;
  }

  async findByEmail(email, excludeId = null) {
    const where = { email };
    if (excludeId) {
      where.id = { [Op.ne]: excludeId };
    }
    return await this.tenantDb.User.findOne({ where });
  }

  async findByMobile(country_code, mobile, excludeId = null) {
    const where = { country_code, mobile };
    if (excludeId) {
      where.id = { [Op.ne]: excludeId };
    }
    return await this.tenantDb.User.findOne({ where });
  }

  async findById(id) {
    return await this.tenantDb.User.findOne({
      where: { id, role_id: 1 },
      attributes: { exclude: SENSITIVE_USER_ATTRS },
      include: [
        {
          model: this.tenantDb.Role,
          as: "role",
          attributes: ["id", "name"],
        },
        {
          model: this.tenantDb.CandidateApplication,
          as: "application",
          required: false,
        },
        {
          model: this.tenantDb.Case,
          as: "cases",
          required: false,
          attributes: ["id", "caseId", "status", "caseStage", "nationality", "visaTypeId"],
        },
      ],
    });
  }

  async create(userData, transaction) {
    return await this.tenantDb.User.create(userData, { transaction });
  }

  async createApplication(appData, transaction) {
    return await this.tenantDb.CandidateApplication.create(appData, { transaction });
  }

  async findApplicationByUserId(userId, transaction) {
    return await this.tenantDb.CandidateApplication.findOne({
      where: { userId },
      transaction
    });
  }

  async updateApplication(application, updateData, transaction, hookOptions = {}) {
    return await application.update(updateData, { transaction, ...hookOptions });
  }

  async createCase(caseData, transaction) {
    return await this.tenantDb.Case.create(caseData, { transaction });
  }

  async findCaseByCandidateId(candidateId, transaction) {
    return await this.tenantDb.Case.findOne({
      where: { candidateId },
      transaction
    });
  }

  async updateCase(caseRecord, updateData, transaction) {
    return await caseRecord.update(updateData, { transaction });
  }

  async findVisaTypeByName(name, transaction) {
    return await this.tenantDb.VisaType.findOne({
      where: { name: { [Op.iLike]: `%${name}%` } },
      transaction
    });
  }

  async findAndCountAll({ where, include, order, limit, offset }) {
    return await this.tenantDb.User.findAndCountAll({
      where,
      attributes: { exclude: SENSITIVE_USER_ATTRS },
      include,
      order,
      limit,
      offset,
      distinct: true,
      subQuery: false,
    });
  }

  async findRoleById(roleId) {
    return await this.tenantDb.Role.findByPk(roleId);
  }

  async transaction(callback) {
    return await this.tenantDb.sequelize.transaction(callback);
  }
}
