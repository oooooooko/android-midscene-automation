import pixelmatch from 'pixelmatch';
import type { PNG } from 'pngjs';
import type { AiDeduplicationConfig } from '../../src/appium-recorder/ai-deduplication';
import { openCv, readImage } from './image-check';

// 彩色 SSIM：各通道均参与比较，避免灰度化丢失广告颜色变化。
// 使用 OpenCV 官方 SSIM 的 11×11 Gaussian 窗口和 C1/C2：
// https://docs.opencv.org/4.12.0/d5/dc4/tutorial_video_input_psnr_ssim.html
async function structuralSimilarity(first: PNG, second: PNG, maxDimension: number) {
  const cv = await openCv();
  const mats: InstanceType<typeof cv.Mat>[] = [];
  const mat = () => { const value = new cv.Mat(); mats.push(value); return value; };
  const scale = Math.min(1, maxDimension / Math.max(first.width, first.height));
  const size = new cv.Size(Math.max(1, Math.round(first.width * scale)), Math.max(1, Math.round(first.height * scale)));
  try {
    const prepare = (image: PNG) => {
      const raw = cv.matFromArray(image.height, image.width, cv.CV_8UC4, image.data);
      mats.push(raw);
      const rgb = mat(), resized = mat(), result = mat();
      cv.cvtColor(raw, rgb, cv.COLOR_RGBA2RGB);
      cv.resize(rgb, resized, size, 0, 0, cv.INTER_AREA);
      resized.convertTo(result, cv.CV_32F);
      return result;
    };
    const a = prepare(first), b = prepare(second);
    const blur = (input: InstanceType<typeof cv.Mat>) => {
      const result = mat();
      cv.GaussianBlur(input, result, new cv.Size(11, 11), 1.5, 1.5, cv.BORDER_REFLECT);
      return result;
    };
    const product = (x: InstanceType<typeof cv.Mat>, y: InstanceType<typeof cv.Mat>) => {
      const result = mat(); cv.multiply(x, y, result); return result;
    };
    const meanAMat = blur(a), meanBMat = blur(b);
    const squareAMat = blur(product(a, a)), squareBMat = blur(product(b, b));
    const crossMat = blur(product(a, b));
    const meanA = meanAMat.data32F, meanB = meanBMat.data32F;
    const squareA = squareAMat.data32F, squareB = squareBMat.data32F, cross = crossMat.data32F;
    let sum = 0;
    for (let i = 0; i < meanA.length; i++) {
      const x = meanA[i]!, y = meanB[i]!;
      const varianceA = Math.max(0, squareA[i]! - x * x), varianceB = Math.max(0, squareB[i]! - y * y);
      const covariance = cross[i]! - x * y;
      sum += ((2 * x * y + 6.5025) * (2 * covariance + 58.5225))
        / ((x * x + y * y + 6.5025) * (varianceA + varianceB + 58.5225));
    }
    return Math.max(-1, Math.min(1, sum / meanA.length));
  } finally { for (const value of mats.reverse()) value.delete(); }
}

// 每次观察独立维护上一张保留帧；不与上一张被丢弃的帧比较，以免缓慢变化被连续吞掉。
export async function createObservationDeduplicator(config: AiDeduplicationConfig) {
  if (config.method === 'opencv') await openCv();
  let previous: PNG | undefined;
  return async (imageBase64: string): Promise<boolean> => {
    if (config.method === 'none') return true;
    const current = readImage(Buffer.from(imageBase64, 'base64'));
    let duplicate = false;
    if (previous && previous.width === current.width && previous.height === current.height) {
      if (previous.data.equals(current.data)) {
        duplicate = true;
      } else if (config.method === 'pixelmatch') {
        const count = pixelmatch(previous.data, current.data, undefined, current.width, current.height,
          { threshold: config.pixelmatch.threshold, includeAA: true });
        duplicate = count / (current.width * current.height) * 100 <= config.pixelmatch.maxChangedRatio;
      } else {
        const score = await structuralSimilarity(previous, current, config.opencv.maxDimension);
        duplicate = score >= config.opencv.similarityThreshold;
      }
    }
    if (!duplicate) previous = current;
    return !duplicate;
  };
}
