import { Op } from "sequelize";
import platformDb from "../models/index.js";
import { sendTransactionalEmail } from "./mail.service.js";

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
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #C8102E;">Subscription Expired</h2>
              <p>Dear ${subscription.organisation.name},</p>
              <p>Your subscription has expired. Your account has been suspended.</p>
              <p>Please contact support to renew your subscription and restore access.</p>
              <p>Best regards,<br/>The EPiC Team</p>
            </div>
          `,
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
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #C8102E;">Subscription Expiring Soon</h2>
              <p>Dear ${subscription.organisation.name},</p>
              <p>Your subscription will expire in <strong>${daysLeft} days</strong>.</p>
              <p>Please renew your subscription to avoid service interruption.</p>
              <p>Best regards,<br/>The EPiC Team</p>
            </div>
          `,
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
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #C8102E;">Urgent: Subscription Expires Tomorrow</h2>
              <p>Dear ${subscription.organisation.name},</p>
              <p>Your subscription will expire <strong>tomorrow</strong>.</p>
              <p>Please renew immediately to maintain uninterrupted access.</p>
              <p>Best regards,<br/>The EPiC Team</p>
            </div>
          `,
        });
      }
    }

    console.log(`✔ Subscription expiry check completed: ${expiredSubscriptions.length} expired, ${expiringSoon.length} expiring soon`);
  } catch (error) {
    console.error("Subscription expiry check failed:", error);
  }
}
