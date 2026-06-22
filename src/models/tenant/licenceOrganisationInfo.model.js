export default (sequelize, DataTypes) => {
  // Step 2 — Organisation information (1:1 with the application).
  const LicenceOrganisationInfo = sequelize.define(
    "LicenceOrganisationInfo",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      licenceApplicationId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        unique: true,
        field: "licence_application_id",
        references: { model: "licence_applications", key: "id" },
      },
      organisationId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "organisation_id",
        references: { model: "organisations", key: "id" },
      },
      organisationType: { type: DataTypes.STRING(100), allowNull: true, field: "organisation_type" },
      // Widened to 50 to match sponsor_profiles.registrationNumber (STRING 50),
      // which syncPersonnelFromProfile copies in here — a 21–50 char value used
      // to overflow the old VARCHAR(20) and 500 the licence-V2 sync.
      companiesHouseNumber: { type: DataTypes.STRING(50), allowNull: true, field: "companies_house_number" },
      payeReference: { type: DataTypes.STRING(50), allowNull: true, field: "paye_reference" },
      accountsOfficeReference: { type: DataTypes.STRING(50), allowNull: true, field: "accounts_office_reference" },
      vatNumber: { type: DataTypes.STRING(30), allowNull: true, field: "vat_number" },
      charityStatus: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: false, field: "charity_status" },
      charityNumber: { type: DataTypes.STRING(30), allowNull: true, field: "charity_number" },
      tradingStartDate: { type: DataTypes.DATEONLY, allowNull: true, field: "trading_start_date" },
      // Simple value-lists stored as Postgres text arrays.
      sicCodes: { type: DataTypes.ARRAY(DataTypes.TEXT), allowNull: true, field: "sic_codes" },
      regions: { type: DataTypes.ARRAY(DataTypes.TEXT), allowNull: true },
      accreditations: { type: DataTypes.ARRAY(DataTypes.TEXT), allowNull: true },
      previousTradingNames: { type: DataTypes.ARRAY(DataTypes.TEXT), allowNull: true, field: "previous_trading_names" },
      // Business Profile sync provenance (null = manually entered).
      lastSyncedAt: { type: DataTypes.DATE, allowNull: true, field: "last_synced_at" },
      lastSyncedByUserId: { type: DataTypes.INTEGER, allowNull: true, field: "last_synced_by_user_id" },
    },
    {
      tableName: "licence_organisation_info",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  return LicenceOrganisationInfo;
};
