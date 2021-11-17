import { NextApiRequest, NextApiResponse } from 'next';

import {
  getAssetMetadataSync,
  getMetadataAsync,
  getPrivateKeyAsync,
  convertSHA256HashToUUID,
  createHash,
  signRSASHA256,
} from '../../common/helpers';

export default async function manifestEndpoint(req: NextApiRequest, res: NextApiResponse) {
  const platform = req.headers['expo-platform'];
  const runtimeVersion = req.headers['expo-runtime-version'] as string;
  const updateBundlePath = `updates/${runtimeVersion}`;

  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.json({ error: 'Expected GET.' });
    return;
  }

  if (platform !== 'ios' && platform !== 'android') {
    res.statusCode = 400;
    res.json({
      error: 'Unsupported platform. Expected either ios or android.',
    });
    return;
  }

  try {
    const { metadataJson, createdAt, id } = await getMetadataAsync({
      updateBundlePath,
      runtimeVersion,
    });
    const platformSpecificMetadata = metadataJson.fileMetadata[platform];
    const manifest = {
      id: convertSHA256HashToUUID(id),
      createdAt,
      runtimeVersion,
      assets: platformSpecificMetadata.assets.map((asset) =>
        getAssetMetadataSync({
          updateBundlePath,
          isLaunchAsset: false,
          filePath: asset.path,
          ext: asset.ext,
          runtimeVersion,
          platform,
        })
      ),
      launchAsset: getAssetMetadataSync({
        updateBundlePath,
        filePath: platformSpecificMetadata.bundle,
        isLaunchAsset: true,
        runtimeVersion,
        platform,
        ext: null,
      }),
    };

    res.statusCode = 200;
    res.setHeader('expo-protocol-version', 0);
    res.setHeader('expo-sfv-version', 0);
    res.setHeader('cache-control', 'private, max-age=0');
    res.setHeader('content-type', 'application/json; charset=utf-8');

    const privateKey = await getPrivateKeyAsync();
    if (privateKey) {
      const manifestString = JSON.stringify(manifest);
      const hash = createHash(manifestString, 'sha256');
      const hashSignature = signRSASHA256(hash, privateKey);
      res.setHeader('expo-signed-hash', hashSignature);
    }

    const assetHeaders: { [key: string]: { [key: string]: string } } = {};
    [...manifest.assets, manifest.launchAsset].forEach((asset) => {
      assetHeaders[asset.key] = {
        'test-header': 'test-header-value',
      };
    });
    res.setHeader('expo-asset-headers', JSON.stringify(assetHeaders));

    res.json(manifest);
  } catch (error) {
    console.error(error);
    res.statusCode = 404;
    res.json({ error });
  }
}
