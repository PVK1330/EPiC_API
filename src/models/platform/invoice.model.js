export default (sequelize, DataTypes) => {
  const Invoice = sequelize.define(
    "Invoice",
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
      subscription_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: "subscriptions",
          key: "id",
        },
      },
      invoice_number: {
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
        type: DataTypes.ENUM('paid', 'pending', 'overdue', 'failed', 'refunded'),
        defaultValue: 'pending',
        allowNull: false,
      },
      payment_method: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      payment_gateway: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      stripe_invoice_id: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      stripe_payment_intent_id: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      paid_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      due_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: "invoices",
      timestamps: true,
    }
  );

  return Invoice;
};
