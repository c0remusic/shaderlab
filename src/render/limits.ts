/**
 * Fail-fast AVANT createTexture : dépasser maxTextureDimension2D ferait
 * échouer la création avec une erreur de validation WebGPU générique
 * (souvent invisible côté JS). Un panorama > limite doit produire un
 * message clair, pas un canvas noir.
 */
export function assertImageFitsGpu(width: number, height: number, maxDimension: number): void {
  if (width > maxDimension || height > maxDimension) {
    throw new Error(
      `Image ${width}×${height} px trop grande pour ce GPU (limite ${maxDimension}×${maxDimension} px).`
    );
  }
}
