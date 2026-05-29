// Integrations Dashboard Controller
// Created at: 2026-05-29

import { Op } from "sequelize";
import logger from "../../../utils/logger.js";
import ApiResponse from "../../../utils/apiResponse.js";
import catchAsync from "../../../utils/catchAsync.js";

export const getMicrosoftDashboardStats = catchAsync(async (req, res) => {
  const { tenantDb } = req;

  // Total connections
  const totalConnections = await tenantDb.CalendarConnection.count({
    where: { provider: 'microsoft', is_active: true }
  });

  // Failed syncs count
  const failedConnections = await tenantDb.CalendarConnection.count({
    where: { provider: 'microsoft', is_active: true, last_sync_status: { [Op.in]: ['TOKEN_EXPIRED', 'REAUTH_REQUIRED'] } }
  });

  // Upcoming meetings synced
  const upcomingMeetings = await tenantDb.MeetingIntegration.count({
    where: { status: 'active' },
    include: [{
      model: tenantDb.Appointment,
      as: 'appointment',
      where: { date: { [Op.gte]: new Date().toISOString().split('T')[0] } }
    }]
  });

  // Retry Queue count
  const retryQueueSize = await tenantDb.IntegrationRetryQueue.count({
    where: { status: 'pending' }
  });

  return ApiResponse.success(res, "Microsoft Dashboard Stats Retrieved", {
    stats: {
      totalConnections,
      failedConnections,
      upcomingMeetings,
      retryQueueSize
    }
  });
});

export const getGoogleDashboardStats = catchAsync(async (req, res) => {
  const { tenantDb } = req;

  // Total connections
  const totalConnections = await tenantDb.CalendarConnection.count({
    where: { provider: 'google', is_active: true }
  });

  // Failed syncs count
  const failedConnections = await tenantDb.CalendarConnection.count({
    where: { provider: 'google', is_active: true, last_sync_status: { [Op.in]: ['TOKEN_EXPIRED', 'REAUTH_REQUIRED'] } }
  });

  // Upcoming meetings synced
  const upcomingMeetings = await tenantDb.MeetingIntegration.count({
    where: { provider: 'google', status: 'active' },
    include: [{
      model: tenantDb.Appointment,
      as: 'appointment',
      where: { date: { [Op.gte]: new Date().toISOString().split('T')[0] } }
    }]
  });

  // Retry Queue count
  const retryQueueSize = await tenantDb.IntegrationRetryQueue.count({
    where: { provider: 'google', status: 'pending' }
  });

  return ApiResponse.success(res, "Google Dashboard Stats Retrieved", {
    stats: {
      totalConnections,
      failedConnections,
      upcomingMeetings,
      retryQueueSize
    }
  });
});

export const getIntegrationRetryQueue = catchAsync(async (req, res) => {
  const { tenantDb } = req;
  const { page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const { count, rows } = await tenantDb.IntegrationRetryQueue.findAndCountAll({
    order: [['created_at', 'DESC']],
    limit: parseInt(limit),
    offset,
    include: [{
      model: tenantDb.User,
      as: 'user',
      attributes: ['id', 'first_name', 'last_name', 'email']
    }]
  });

  return ApiResponse.success(res, "Retry Queue Retrieved", {
    queue: rows,
    pagination: {
      total: count,
      page: parseInt(page),
      limit: parseInt(limit),
      pages: Math.ceil(count / parseInt(limit))
    }
  });
});

export const getIntegrationSyncLogs = catchAsync(async (req, res) => {
  const { tenantDb } = req;
  const { page = 1, limit = 50 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const { count, rows } = await tenantDb.IntegrationSyncLog.findAndCountAll({
    order: [['created_at', 'DESC']],
    limit: parseInt(limit),
    offset,
    include: [{
      model: tenantDb.User,
      as: 'user',
      attributes: ['id', 'first_name', 'last_name', 'email']
    }]
  });

  return ApiResponse.success(res, "Sync Logs Retrieved", {
    logs: rows,
    pagination: {
      total: count,
      page: parseInt(page),
      limit: parseInt(limit),
      pages: Math.ceil(count / parseInt(limit))
    }
  });
});
