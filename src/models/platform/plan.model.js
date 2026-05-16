export default (sequelize, DataTypes) => {
  const Plan = sequelize.define(
    "Plan",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      name: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: true,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      price: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      currency: {
        type: DataTypes.STRING(10),
        allowNull: false,
        defaultValue: 'GBP',
      },
      billing_cycle: {
        type: DataTypes.ENUM('monthly', 'yearly', 'one-time'),
        allowNull: false,
        defaultValue: 'monthly',
      },
      user_quota: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 5,
      },
      case_quota: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 50,
      },
      storage_quota_gb: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
      },
      features: {
        type: DataTypes.JSONB,
        allowNull: true,
        defaultValue: [],
      },
      is_public: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
      },
      status: {
        type: DataTypes.ENUM('active', 'inactive', 'archived'),
        defaultValue: 'active',
      }
    },
    {
      tableName: "plans",
      timestamps: true,
    }
  );

  return Plan;
};
