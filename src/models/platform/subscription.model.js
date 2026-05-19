export default (sequelize, DataTypes) => {
  const Subscription = sequelize.define(
    "Subscription",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      organisation_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: "organisations",
          key: "id",
        },
      },
      plan_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: "plans",
          key: "id",
        },
      },
      status: {
        type: DataTypes.ENUM('active', 'trial', 'expired', 'cancelled', 'past_due'),
        defaultValue: 'trial',
        allowNull: false,
      },
      current_period_start: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      current_period_end: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      trial_ends_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      cancelled_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      stripe_subscription_id: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      stripe_customer_id: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
    },
    {
      tableName: "subscriptions",
      timestamps: true,
    }
  );

  return Subscription;
};
