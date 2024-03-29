import axios from 'axios';
import { Web3Wrapper, TxData, SupportedProvider } from '@0x/web3-wrapper';
import {
  GetSwapQuoteResponse,
  ZeroExSwapAPIParams,
  ERC20TokenContract,
} from './misc';
import {
  getContractAddressesForChainOrThrow,
  ChainId,
} from '@0x/contract-addresses';
import { BigNumber } from '@0x/utils';
import { Web3ProviderEngine } from '@0x/subproviders';

const zeroExDeployedAddresses = getContractAddressesForChainOrThrow(
  ChainId.Kovan
);

async function introToERC20TokenContract(
  web3Provider: Web3ProviderEngine
): Promise<void> {
  // A quick example of ERC20TokenContract

  // Initializing a new instance of ERC20TokenContract
  const tokenAddress = '0x48178164eB4769BB919414Adc980b659a634703E'; // Address of fake DAI token
  const tokenContract: ERC20TokenContract = new ERC20TokenContract(
    tokenAddress,
    web3Provider
  );

  // Reading a value on the blockchain does NOT require a transaction.
  const name = await tokenContract.name().callAsync();
  const decimals = await tokenContract.decimals().callAsync();
  const balance = await tokenContract.balanceOf('0xSomeAddress').callAsync();

  console.log(name); // DAI
  console.log(decimals); // 18
  console.log(balance); // 100000000000000000000

  // Writing a value on the blockchain
  await tokenContract
    .transfer('0xSomeOtherAddress', new BigNumber(100000000000000000000))
    .awaitTransactionSuccessAsync({
      from: '0xMyAddress',
    });
}

/**
 * Converts a humanly-readable number (that may contain decimals, example: 133.232) into a big integer.
 * Why do we need this: Ethereum can only only store integer values, so, in order to generate a number
 * that can be diplayed to users (in a UI), you need to store that number as a big integer + the number of
 * decimal places.
 *
 * Example:
 * (USDC has 6 decimals, DAI has 18 decimals)
 *
 * - convertValueFromHumanToEthereum(usdcToken, 5) returns 5000000
 * - convertValueFromHumanToEthereum(daiToken, 20.5) returns 20500000000000000000
 *
 * @param tokenWrapper an instance of the ERC20 token wrapper
 * @param unitAmount a number representing the human-readable number
 * @returns a big integer that can be used to interact with Ethereum
 */
async function convertValueFromHumanToEthereum(
  tokenWrapper: ERC20TokenContract,
  unitAmount: number
): Promise<BigNumber> {
  const decimals = (await tokenWrapper.decimals().callAsync()).toNumber();
  return Web3Wrapper.toBaseUnitAmount(unitAmount, decimals);
}

/**
 * Performs a trade by requesting a quote from the 0x API, and filling that quote on the blockchain
 * @param buyToken the token address to buy
 * @param sellToken the token address to sell
 * @param amountToSellUnitAmount the token amount to sell
 * @param fromAddress the address that will perform the transaction
 * @param client the Web3Wrapper client
 */
export async function performSwapAsync(
  buyTokenWrapper: ERC20TokenContract,
  sellTokenWrapper: ERC20TokenContract,
  amountToSellUnitAmount: number,
  fromAddress: string,
  provider: SupportedProvider
): Promise<void> {
  // Step #1) Does the user have enough balance?
  // Convert the unit amount into base unit amount (bigint). For this to happen you need the number of decimals the token.
  const decimals = (await sellTokenWrapper.decimals().callAsync()).toNumber();
  const tokenBalance = Web3Wrapper.toUnitAmount(
    await sellTokenWrapper.balanceOf(fromAddress).callAsync(),
    decimals
  )
    .decimalPlaces(2)
    .toNumber();
  if (tokenBalance < amountToSellUnitAmount) {
    alert('Not Enough Balance');
    throw new Error('Not Enough Balance');
  }
  // Step #2) Does the 0x ERC20 Proxy have permission to withdraw funds from the exchange?
  // In order to allow the 0x smart contracts to trade with your funds, you need to set an allowance for zeroExDeployedAddresses.erc20Proxy.
  // This can be done using the `approve` function.
  const allowance = Web3Wrapper.toUnitAmount(
    await sellTokenWrapper
      .allowance(fromAddress, zeroExDeployedAddresses.erc20Proxy)
      .callAsync(),
    decimals
  )
    .decimalPlaces(2)
    .toNumber();
  if (allowance < amountToSellUnitAmount) {
    const tx = await sellTokenWrapper
      .approve(
        zeroExDeployedAddresses.erc20Proxy,
        Web3Wrapper.toBaseUnitAmount(
          amountToSellUnitAmount,
          (await sellTokenWrapper.decimals().callAsync()).toNumber()
        )
      )
      .awaitTransactionSuccessAsync({
        from: fromAddress,
      });
    console.log(tx);
  }

  // Step #3) Make a request to the 0x API swap endpoint: https://0x.org/docs/guides/swap-tokens-with-0x-api#swap-eth-for-1-dai
  // You can use the line below as guidance. In the example, the variable TxData contains the deserialized JSON response from the API.
  const sellAmountInBaseUnits = (
    await convertValueFromHumanToEthereum(
      sellTokenWrapper,
      amountToSellUnitAmount
    )
  ).toString();
  const url = `https://kovan.api.0x.org/swap/v0/quote`;
  const params: ZeroExSwapAPIParams = {
    buyToken: buyTokenWrapper.address,
    sellToken: sellTokenWrapper.address,
    sellAmount: sellAmountInBaseUnits,
    takerAddress: fromAddress,
  };
  const httpResponse = await axios.get<GetSwapQuoteResponse>(url, {
    params,
  });
  const txData: TxData = httpResponse.data;
  console.log(`Ethereum transaction generated by the 0x API: 👇`);
  console.log(txData);

  console.log(`Orders used to perform the swap 👇`);
  console.log(httpResponse.data.orders);

  // Step #4) You can `client.sendTransactionAsync()` to send a Ethereum transaction.
  const client = new Web3Wrapper(provider);
  const tx = await client.sendTransactionAsync({
    from: fromAddress,
    to: txData.to,
    data: txData.data,
    gas: txData.gas,
    gasPrice: txData.gasPrice,
    value: txData.value,
  });
  const receipt = await client.awaitTransactionSuccessAsync(tx);
  console.log(`Transaction ${receipt.transactionHash} was mined successfully`);
}
