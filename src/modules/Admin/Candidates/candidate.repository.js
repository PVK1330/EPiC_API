import { Op } from 'sequelize';

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

  async updateApplication(application, updateData, transaction) {
    return await application.update(updateData, { transaction });
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
