export default (sequelize, DataTypes) => {
  // One row per licence application. Created when the caseworker begins the
  // government portal registration stage. Password field is AES-256 encrypted
  // at the application layer before INSERT — never stored in plain text.
  const LicenceGovernmentTracking = sequelize.define(
    "LicenceGovernmentTracking",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      licenceApplicationId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        unique: true,
        field: "licence_application_id",
        references: { model: "licence_applications", key: "id" },
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      },
      smsPortalUsername: {
        type: DataTypes.STRING(255),
        allowNull: true,
        field: "sms_portal_username",
      },
      smsRegistrationRef: {
        type: DataTypes.STRING(100),
        allowNull: true,
        field: "sms_registration_ref",
      },
      credentialsGeneratedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "credentials_generated_at",
      },
      credentialsSentAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "credentials_sent_at",
      },
      ukviPortalUserId: {
        type: DataTypes.STRING(255),
        allowNull: true,
        field: "ukvi_portal_user_id",
      },
      ukviPortalPasswordEncrypted: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: "ukvi_portal_password_encrypted",
      },
      ukviCredentialsSubmittedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "ukvi_credentials_submitted_at",
      },
      governmentRegistrationRef: {
        type: DataTypes.STRING(100),
        allowNull: true,
        field: "government_registration_ref",
      },
      governmentSubmissionRef: {
        type: DataTypes.STRING(100),
        allowNull: true,
        field: "government_submission_ref",
      },
      governmentSubmissionDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
        field: "government_submission_date",
      },
    },
    {
      tableName: "licence_government_tracking",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  return LicenceGovernmentTracking;
};
