export default (sequelize, DataTypes) => {
  const CasePayment = sequelize.define(
    "CasePayment",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      caseId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'cases',
          key: 'id'
        }
      },
      paymentType: {
        type: DataTypes.ENUM('fee', 'installment', 'additional_charge', 'refund'),
        allowNull: false,
        defaultValue: 'fee',
        comment: "Type of payment"
      },
      amount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        comment: "Payment amount"
      },
      paymentMethod: {
        type: DataTypes.ENUM('cash', 'check', 'credit_card', 'bank_transfer', 'online'),
        allowNull: false,
        comment: "Method of payment"
      },
      paymentDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
        comment: "Date when payment was made"
      },
      paymentStatus: {
        type: DataTypes.ENUM('pending', 'completed', 'failed', 'refunded'),
        allowNull: false,
        defaultValue: 'pending',
        comment: "Status of the payment"
      },
      transactionId: {
        type: DataTypes.STRING(100),
        allowNull: true,
        comment: "Transaction ID for reference"
      },
      invoiceNumber: {
        type: DataTypes.STRING(50),
        allowNull: true,
        comment: "Invoice number for the payment"
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: "Description of what the payment is for"
      },
      receivedBy: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id'
        },
        comment: "User who received the payment"
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: "Additional notes about the payment"
      },
      dueDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
        comment: "Due date for the payment"
      },
      isRecurring: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: "Whether this is a recurring payment"
      },
    },
    {
      tableName: 'case_payments',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at'
    }
  );

  return CasePayment;
};
