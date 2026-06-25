import type { RoutesConfig } from "@x402/core/server";
import {
  createSplit402ResourceServerExtension,
  declareSplit402
} from "@split402/x402-extension";

import {
  CachedControlPlaneCampaignResolver,
  ControlPlaneReceiptSubmitter,
  InMemoryMerchantReceiptOutboxStore,
  InMemoryMerchantServiceKeyRing,
  MerchantReceiptOutboxDispatcher,
  declareRequiredPaymentIdentifierExtension,
  type MerchantReceiptOutboxStore,
  type MerchantServiceSigningKey
} from "../src/index.js";

export interface Split402ExpressIntegrationOptions {
  controlPlaneUrl: string;
  merchantId: string;
  merchantOrigin: string;
  campaignId: string;
  operationId: string;
  method: "GET" | "POST";
  pathTemplate: string;
  network: `${string}:${string}`;
  asset: string;
  requiredAmountAtomic: string;
  payToWallet: string;
  serviceKey: MerchantServiceSigningKey;
  previousServiceKeys?: MerchantServiceSigningKey[];
  receiptOutbox?: MerchantReceiptOutboxStore;
}

export async function createSplit402ExpressIntegration(
  options: Split402ExpressIntegrationOptions
) {
  const campaignResolver = new CachedControlPlaneCampaignResolver({
    controlPlaneUrl: options.controlPlaneUrl
  });
  await campaignResolver.refreshCampaign(options.campaignId);

  const receiptOutbox =
    options.receiptOutbox ?? new InMemoryMerchantReceiptOutboxStore();
  const serviceKeyProvider = new InMemoryMerchantServiceKeyRing({
    current: options.serviceKey,
    ...(options.previousServiceKeys === undefined
      ? {}
      : { additional: options.previousServiceKeys })
  });
  const split402Extension = createSplit402ResourceServerExtension({
    merchantId: options.merchantId,
    merchantOrigin: options.merchantOrigin,
    serviceKeyProvider,
    resolveCampaign: campaignResolver.resolveCampaign,
    receiptSink: async (receipt) => {
      await receiptOutbox.enqueueReceipt({ receipt });
    }
  });
  const receiptDispatcher = new MerchantReceiptOutboxDispatcher(
    receiptOutbox,
    new ControlPlaneReceiptSubmitter({
      controlPlaneUrl: options.controlPlaneUrl
    })
  );
  const routes: RoutesConfig = {
    [`${options.method} ${options.pathTemplate}`]: {
      accepts: [
        {
          scheme: "exact",
          network: options.network,
          price: {
            asset: options.asset,
            amount: options.requiredAmountAtomic
          },
          payTo: options.payToWallet
        }
      ],
      description: `${options.operationId} paid API`,
      mimeType: "application/json",
      extensions: {
        ...declareSplit402({
          campaignId: options.campaignId,
          operationId: options.operationId
        }),
        ...declareRequiredPaymentIdentifierExtension()
      }
    }
  };

  return {
    campaignResolver,
    receiptOutbox,
    receiptDispatcher,
    routes,
    split402Extension
  };
}
