varying vec2 vUv;

uniform sampler2D texture1;
uniform sampler2D texture2;
uniform sampler2D disp;

uniform float dispPower;
uniform float intensity;

uniform vec2 size;
uniform vec2 res;

vec2 backgroundCoverUV(vec2 screenSize, vec2 imageSize, vec2 uv) {
  float screenRatio = screenSize.x / screenSize.y;
  float imageRatio = imageSize.x / imageSize.y;
  vec2 newSize = screenRatio < imageRatio 
      ? vec2(imageSize.x * (screenSize.y / imageSize.y), screenSize.y)
      : vec2(screenSize.x, imageSize.y * (screenSize.x / imageSize.x));

  vec2 newOffset = (screenRatio < imageRatio)
      ? vec2((screenSize.x - newSize.x) * 0.5, 0)
      : vec2(0, (screenSize.y - newSize.y) * 0.5);

  return (uv * newSize + newOffset) / screenSize;
}
