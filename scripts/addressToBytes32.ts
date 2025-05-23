import { ethers } from "hardhat";
import { encode, decode } from "hi-base32";

// 지갑 주소를 통해 23자리 고정된 알파벳 문자열로 변환
function toUppercaseAZHash(input: string, length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const hash = ethers.utils.arrayify(
    ethers.utils.keccak256(Buffer.from(input)),
  );
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars[hash[i] % chars.length];
  }
  return result;
}

(async () => {
  const [operator] = await ethers.getSigners();

  const suffixType = "bytes32";
  const suffixName = toUppercaseAZHash(operator.address, 23);

  console.log(suffixName);

  const requestSuffixType = Buffer.from(`${suffixType} ${suffixName})`, "utf8");
  console.log(requestSuffixType);
  console.log(requestSuffixType.length);
})();
