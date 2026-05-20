export default (sequelize, DataTypes) => {
  const CandidateAccountSettings = sequelize.define(
    "CandidateAccountSettings",
    {
      user_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        allowNull: false,
        references: { model: "users", key: "id" },
        onDelete: "CASCADE",
      },
      notification_document_requests: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      notification_case_status: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      notification_payment_reminders: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      notification_deadline_alerts: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      terms_accepted_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      terms_version: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      data_deletion_requested_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      stripe_customer_id: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      stripe_subscription_id: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      subscription_status: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      subscription_current_period_end: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: "candidate_account_settings",
      timestamps: true,
    }
  );

  return CandidateAccountSettings;
};
