export default (sequelize, DataTypes) => {
  const SponsorPayment = sequelize.define(
    "SponsorPayment",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      sponsorUserId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: "sponsor_user_id",
      },
      organisationId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "organisation_id",
      },
      // 'licence_fee' | 'isc' — case-fee payments live in case_payments instead.
      payableType: {
        type: DataTypes.STRING(40),
        allowNull: false,
        field: "payable_type",
      },
      payableRef: {
        type: DataTypes.STRING(100),
        allowNull: true,
        field: "payable_ref",
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      amount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
      },
      currency: {
        type: DataTypes.STRING(3),
        allowNull: false,
        defaultValue: "GBP",
      },
      status: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: "pending",
      },
      stripeSessionId: {
        type: DataTypes.STRING(255),
        allowNull: true,
        field: "stripe_session_id",
      },
      stripePaymentIntentId: {
        type: DataTypes.STRING(255),
        allowNull: true,
        field: "stripe_payment_intent_id",
      },
      paidAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "paid_at",
      },
    },
    {
      tableName: "sponsor_payments",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  return SponsorPayment;
};
