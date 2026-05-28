import { Op } from "sequelize";
import platformDb from "../models/index.js";
import { sendTransactionalEmail } from "./mail.service.js";
import { generateSubscriptionExpiryTemplate } from "../utils/emailTemplates.js";
import logger from "../utils/logger.js";

export async function checkAndExpireSubscriptions() {
  try {
    const now = new Date();

    const expiredSubscriptions = await platformDb.Subscription.findAll({
      where: {
        current_period_end: { [Op.lt]: now },
        status: { [Op.in]: ['active', 'trial'] },
      },
      include: [
        {
          model: platformDb.Organisation,
          as: "organisation",
          attributes: ["id", "name", "primaryEmail"],
        },
      ],
    });

    for (const subscription of expiredSubscriptions) {
      await subscription.update({ status: 'expired' });

      if (subscription.organisation) {
        await platformDb.Organisation.update(
          { status: 'suspended' },
          { where: { id: subscription.organisation.id } }
        );

        await sendTransactionalEmail({
          organisationId: subscription.organisation.id,
          to: subscription.organisation.primaryEmail,
          subject: "EPiC - Subscription Expired",
          html: generateSubscriptionExpiryTemplate({
            organisationName: subscription.organisation.name,
            daysRemaining: 0,
            loginUrl: process.env.FRONTEND_URL || "http://localhost:5173",
            type: subscription.status
          }),
        });
      }
    }

    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

    const expiringSoon = await platformDb.Subscription.findAll({
      where: {
        current_period_end: {
          [Op.gte]: now,
          [Op.lte]: sevenDaysFromNow,
        },
        status: { [Op.in]: ['active', 'trial'] },
      },
      include: [
        {
          model: platformDb.Organisation,
          as: "organisation",
          attributes: ["id", "name", "primaryEmail"],
        },
      ],
    });

    for (const subscription of expiringSoon) {
      if (subscription.organisation) {
        const daysLeft = Math.ceil((new Date(subscription.current_period_end) - now) / (1000 * 60 * 60 * 24));

        await sendTransactionalEmail({
          organisationId: subscription.organisation.id,
          to: subscription.organisation.primaryEmail,
          subject: `EPiC - Subscription Expiring in ${daysLeft} Days`,
          html: generateSubscriptionExpiryTemplate({
            organisationName: subscription.organisation.name,
            daysRemaining: daysLeft,
            loginUrl: process.env.FRONTEND_URL || "http://localhost:5173",
            type: subscription.status
          }),
        });
      }
    }

    const oneDayFromNow = new Date();
    oneDayFromNow.setDate(oneDayFromNow.getDate() + 1);

    const expiringTomorrow = await platformDb.Subscription.findAll({
      where: {
        current_period_end: {
          [Op.gte]: now,
          [Op.lte]: oneDayFromNow,
        },
        status: { [Op.in]: ['active', 'trial'] },
      },
      include: [
        {
          model: platformDb.Organisation,
          as: "organisation",
          attributes: ["id", "name", "primaryEmail"],
        },
      ],
    });

    for (const subscription of expiringTomorrow) {
      if (subscription.organisation) {
        await sendTransactionalEmail({
          organisationId: subscription.organisation.id,
          to: subscription.organisation.primaryEmail,
          subject: "EPiC - Subscription Expires Tomorrow",
          html: generateSubscriptionExpiryTemplate({
            organisationName: subscription.organisation.name,
            daysRemaining: 1,
            loginUrl: process.env.FRONTEND_URL || "http://localhost:5173",
            type: subscription.status
          }),
        });
      }
    }

    logger.info({ expired: expiredSubscriptions.length, expiringSoon: expiringSoon.length }, "Subscription expiry check completed");
  } catch (error) {
    logger.error({ err: error }, "Subscription expiry check failed");
  }
}
