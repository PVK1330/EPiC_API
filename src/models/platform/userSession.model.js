export default (sequelize, DataTypes) => {
    const UserSession = sequelize.define(
        "UserSession",
        {
            id: {
                type: DataTypes.INTEGER,
                primaryKey: true,
                autoIncrement: true,
            },
            user_id: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: 'users',
                    key: 'id'
                }
            },
            refresh_token_hash: {
                type: DataTypes.STRING(255),
                allowNull: false,
            },
            device: {
                type: DataTypes.STRING(255),
                allowNull: true,
            },
            browser: {
                type: DataTypes.STRING(255),
                allowNull: true,
            },
            ip_address: {
                type: DataTypes.STRING(100),
                allowNull: true,
            },
            last_active: {
                type: DataTypes.DATE,
                defaultValue: DataTypes.NOW,
            }
        },
        {
            tableName: "user_sessions",
            timestamps: true,
            createdAt: "created_at",
            updatedAt: "updated_at",
        }
    );

    return UserSession;
};
