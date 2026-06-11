export default (sequelize, DataTypes) => {
  // Step 3 — Structured CoS requirement (1:N with the application).
  const LicenceCosRequirement = sequelize.define(
    "LicenceCosRequirement",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      licenceApplicationId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: "licence_application_id",
        references: { model: "licence_applications", key: "id" },
      },
      organisationId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "organisation_id",
        references: { model: "organisations", key: "id" },
      },
      socCode: { type: DataTypes.STRING(10), allowNull: true, field: "soc_code" },
      roleTitle: { type: DataTypes.STRING(255), allowNull: true, field: "role_title" },
      salary: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
      salaryCurrency: { type: DataTypes.STRING(3), allowNull: true, defaultValue: "GBP", field: "salary_currency" },
      candidateName: { type: DataTypes.STRING(255), allowNull: true, field: "candidate_name" },
      candidateNationality: { type: DataTypes.STRING(100), allowNull: true, field: "candidate_nationality" },
      candidateDob: { type: DataTypes.DATEONLY, allowNull: true, field: "candidate_dob" },
      candidateEmail: { type: DataTypes.STRING(255), allowNull: true, field: "candidate_email" },
      sponsorshipDurationMonths: { type: DataTypes.SMALLINT, allowNull: true, field: "sponsorship_duration_months" },
    },
    {
      tableName: "licence_cos_requirements",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  return LicenceCosRequirement;
};
