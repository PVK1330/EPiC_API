export default (sequelize, DataTypes) => {
  const CaseCommunication = sequelize.define(
    "CaseCommunication",
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
      messageType: {
        type: DataTypes.ENUM('email', 'sms', 'phone_call', 'note', 'system_notification'),
        allowNull: false,
        defaultValue: 'note',
        comment: "Type of communication"
      },
      subject: {
        type: DataTypes.STRING(255),
        allowNull: true,
        comment: "Subject of the communication"
      },
      message: {
        type: DataTypes.TEXT,
        allowNull: false,
        comment: "Content of the communication"
      },
      senderId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id'
        },
        comment: "User who sent the message"
      },
      recipientId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id'
        },
        comment: "User who received the message"
      },
      recipientType: {
        type: DataTypes.ENUM('candidate', 'business', 'caseworker', 'admin', 'external'),
        allowNull: false,
        comment: "Type of recipient"
      },
      recipientEmail: {
        type: DataTypes.STRING(255),
        allowNull: true,
        comment: "Email address of external recipient"
      },
      sentDate: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: "Date when the communication was sent"
      },
      readDate: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: "Date when the communication was read"
      },
      status: {
        type: DataTypes.ENUM('draft', 'sent', 'delivered', 'read', 'failed'),
        allowNull: false,
        defaultValue: 'draft',
        comment: "Status of the communication"
      },
      direction: {
        type: DataTypes.ENUM('inbound', 'outbound'),
        allowNull: false,
        defaultValue: 'outbound',
        comment: "Direction of communication"
      },
      attachments: {
        type: DataTypes.JSON,
        allowNull: true,
        comment: "Array of attachment file paths"
      },
      priority: {
        type: DataTypes.ENUM('low', 'normal', 'high', 'urgent'),
        allowNull: false,
        defaultValue: 'normal',
        comment: "Priority level of the communication"
      },
      isInternal: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: "Whether this is an internal communication"
      },
      requiresResponse: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: "Whether this communication requires a response"
      },
      responseDueDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
        comment: "Due date for response if required"
      },
    },
    {
      tableName: 'case_communications',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at'
    }
  );

  return CaseCommunication;
};
