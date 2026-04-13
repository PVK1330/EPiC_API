export default (sequelize, DataTypes) => {
    const User = sequelize.define(
        "User",
        {
            id: {
                type: DataTypes.INTEGER,
                primaryKey: true,
                autoIncrement: true,
            },

            first_name: {
                type: DataTypes.STRING(100),
                allowNull: false,
            },
            last_name: {
                type: DataTypes.STRING(100),
                allowNull: false,
            },
            email: {
                type: DataTypes.STRING(255),
                allowNull: false,
                unique: true,
                validate: {
                    isEmail: true,
                },
            },

            country_code: {
                type: DataTypes.STRING(10),
                allowNull: false,
            },

            mobile: {
                type: DataTypes.STRING(20),
                allowNull: false,
            },

            password: {
                type: DataTypes.TEXT,
                allowNull: false,
                validate: {
                    len: {
                        args: [8, 100],
                        msg: "Password must be at least 8 characters",
                    },
                },
            },
            otp_code: {
                type: DataTypes.STRING(10),
            },

            otp_expiry: {
                type: DataTypes.DATE,
                allowNull: true,
            },
            is_otp_verified: {
                type: DataTypes.BOOLEAN,
                defaultValue: false,
            },
            temp_password: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            role_id: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: "roles",
                    key: "id",
                },
                onUpdate: "CASCADE",
                onDelete: "CASCADE",
            },
            is_email_verified: {
                type: DataTypes.BOOLEAN,
                defaultValue: false,
            },
            status: {
                type: DataTypes.ENUM('active', 'inactive', 'suspended'),
                defaultValue: 'active',
                allowNull: false,
            },
            password_reset_otp: {
                type: DataTypes.STRING(10),
            },
            password_reset_otp_expiry: {
                type: DataTypes.DATE,
            },
        },
        {
            tableName: "users",
            timestamps: true,
 
            indexes: [
                {
                    unique: true,
                    fields: ["country_code", "mobile"],
                },
            ],
        }
    );

    return User;
};