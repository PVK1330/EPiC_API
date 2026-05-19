export default (sequelize, DataTypes) => {
  const PaymentTransaction = sequelize.define(
    "PaymentTransaction",
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
      invoice_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: "invoices",
          key: "id",
        },
      },
      reference: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: true,
      },
      amount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      currency: {
        type: DataTypes.STRING(10),
        allowNull: false,
        defaultValue: 'GBP',
      },
      status: {
        type: DataTypes.ENUM('completed', 'failed', 'processing', 'refunded'),
        defaultValue: 'processing',
        allowNull: false,
      },
      payment_method: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      gateway: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      gateway_reference: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      failure_reason: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      metadata: {
        type: DataTypes.JSONB,
        allowNull: true,
      },
    },
    {
      tableName: "payment_transactions",
      timestamps: true,
    }
  );

  return PaymentTransaction;
};
