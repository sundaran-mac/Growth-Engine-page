/**
 * WhatsApp: no official posting API for Channels, so Growth Desk never posts. At the post time
 * the owner gets a reminder with the file, and posts by hand (ADR 0007, runbook section 4).
 */
import { type Connector, ConnectorError } from './types.js';

export const whatsappConnector: Connector = {
  platform: 'whatsapp',
  capabilities: {
    publish: false,
    video: true,
    image: true,
    mediaTransfer: 'manual',
    ratios: ['9:16', '1:1'],
    metrics: false,
    privateReply: false,
    maxCaptionLength: 4096,
    clickableLinks: true,
  },
  publish() {
    return Promise.reject(new ConnectorError('UNSUPPORTED_FORMAT', 'WhatsApp is posted by hand. Growth Desk sends a reminder with the file.'));
  },
  fetchMetrics() {
    return Promise.reject(new ConnectorError('UNSUPPORTED_FORMAT', 'WhatsApp has no metrics API.'));
  },
};
