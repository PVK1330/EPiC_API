export default (sequelize, DataTypes) => {
    const AuditLog = sequelize.define(
        "AuditLog",
        {
            id: {
                type: DataTypes.INTEGER,
                primaryKey: true,
                autoIncrement: true,
            },

            user_id: {
                type: DataTypes.INTEGER,
                allowNull: true,
                references: {
                    model: "users",
                    key: "id",
                },
            },

            user_name: {
                type: DataTypes.STRING(255),
                allowNull: true,
            },

            action: {
                type: DataTypes.ENUM(
                    "LOGIN",
                    "LOGOUT",
                    "CASE_CREATED",
                    "CASE_UPDATED",
                    "PAYMENT_PROCESSED",
                    "USER_CREATED",
                    "USER_UPDATED",
                    "DOCUMENT_UPLOADED",
                    "DOCUMENT_DELETED",
                    "CASE_DELETED",
                    "PAYMENT_DELETED"
                ),
                allowNull: false,
            },

            resource_type: {
                type: DataTypes.ENUM("CASE", "SYSTEM", "INVOICE", "USER", "DOCUMENT"),
                allowNull: false,
            },

            resource_id: {
                type: DataTypes.STRING(255),
                allowNull: false,
                comment: "case_id, invoice_number, user_id, or SYSTEM",
            },

            ip_address: {
                type: DataTypes.STRING(50),
                allowNull: true,
            },

            user_agent: {
                type: DataTypes.TEXT,
                allowNull: true,
            },

            status: {
                type: DataTypes.ENUM("SUCCESS", "FAILED", "PENDING"),
                defaultValue: "SUCCESS",
            },

            details: {
                type: DataTypes.TEXT,
                allowNull: true,
                comment: "Additional details in JSON format",
            },

            createdAt: {
                type: DataTypes.DATE,
                defaultValue: DataTypes.NOW,
            },

            updatedAt: {
                type: DataTypes.DATE,
                defaultValue: DataTypes.NOW,
            },
        },
        {
            tableName: "AuditLogs",
            timestamps: true,
            indexes: [
                {
                    fields: ["user_id"],
                },
                {
                    fields: ["action"],
                },
                {
                    fields: ["resource_type"],
                },
                {
                    fields: ["status"],
                },
                {
                    fields: ["createdAt"],
                },
                {
                    fields: ["user_id", "createdAt"],
                },
            ],
        }
    );

    return AuditLog;
};
