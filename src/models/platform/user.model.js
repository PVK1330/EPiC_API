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

            last_login: {
                type: DataTypes.DATE,
                allowNull: true,
            },
            failed_login_attempts: {
                type: DataTypes.INTEGER,
                defaultValue: 0,
                allowNull: false
            },
            locked_until: {
                type: DataTypes.DATE,
                allowNull: true
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
            two_factor_secret: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            two_factor_enabled: {
                type: DataTypes.BOOLEAN,
                defaultValue: false,
            },
            two_factor_backup_codes: {
                type: DataTypes.JSON,
                allowNull: true,
            },
            password_changed_at: {
                type: DataTypes.DATE,
                allowNull: true,
            },
            profile_pic: {
                type: DataTypes.STRING(500),
                allowNull: true,
            },
            gender: {
                type: DataTypes.ENUM('male', 'female', 'other'),
                allowNull: true,
                defaultValue: 'other',
            },
            organisation_id: {
                type: DataTypes.INTEGER,
                allowNull: true, // Nullable for Superadmins who don't belong to an org
                references: {
                    model: "organisations",
                    key: "id",
                },
                onUpdate: "CASCADE",
                onDelete: "SET NULL",
            },
        },
        {
            tableName: "users",
            timestamps: true,

            indexes: [
                {
                    unique: true,
                    fields: ["country_code", "mobile", "organisation_id"],
                },
            ],
            hooks: {
                afterUpdate: async (instance, options) => {
                    const { trackFieldChanges } = await import('../../services/auditTracking.service.js');
                    await trackFieldChanges(instance, options);
                }
            }
        }
    );

    return User;
};
