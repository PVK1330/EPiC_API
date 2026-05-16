export default (sequelize, DataTypes) => {
  const PaymentSetting = sequelize.define(
    "PaymentSetting",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      currency: {
        type: DataTypes.STRING,
        defaultValue: "GBP",
      },
      pay_bank: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
      },
      pay_card: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
      },
      pay_cheque: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
      invoice_prefix: {
        type: DataTypes.STRING,
        defaultValue: "INV-",
      },
      stripe_public_key: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      stripe_secret_key: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      paypal_client_id: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      paypal_secret: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      razorpay_key_id: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      razorpay_key_secret: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      active_gateway: {
        type: DataTypes.STRING,
        defaultValue: "stripe",
      },
    },
    {
      tableName: "payment_settings",
      timestamps: true,
    }
  );

  return PaymentSetting;
};
