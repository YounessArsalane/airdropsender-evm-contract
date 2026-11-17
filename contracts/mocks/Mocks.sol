// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
contract Std is ERC20 { constructor() ERC20("S","S"){ _mint(msg.sender,1e30);} }
contract Fot is ERC20 { constructor() ERC20("F","F"){ _mint(msg.sender,1e30);}
  function _update(address f,address t,uint256 v) internal override { if(f!=address(0)&&t!=address(0)){uint256 fee=v/100; super._update(f,address(0xfee),fee); v-=fee;} super._update(f,t,v);} }
contract UsdtLike { mapping(address=>uint) public balanceOf; mapping(address=>mapping(address=>uint)) public allowance; mapping(address=>bool) public black;
  constructor(){balanceOf[msg.sender]=1e30;} function setBlack(address a) external {black[a]=true;}
  function approve(address s,uint v) external { require(v==0||allowance[msg.sender][s]==0,"usdt approve"); allowance[msg.sender][s]=v; }
  function transfer(address t,uint v) external { require(!black[t],"blacklisted"); balanceOf[msg.sender]-=v; balanceOf[t]+=v; }
  function transferFrom(address f,address t,uint v) external { require(!black[t],"blacklisted"); allowance[f][msg.sender]-=v; balanceOf[f]-=v; balanceOf[t]+=v; } }
contract BoolFalse is ERC20 { mapping(address=>bool) public bad; constructor() ERC20("B","B"){ _mint(msg.sender,1e30);} function setBad(address a) external {bad[a]=true;}
  function transferFrom(address f,address t,uint256 v) public override returns(bool){ if(bad[t]) return false; return super.transferFrom(f,t,v);} }
interface IHook { function onReceive(address) external; }
contract HookToken is ERC20 { constructor() ERC20("H","H"){ _mint(msg.sender,1e30);}
  function _update(address f,address t,uint256 v) internal override { super._update(f,t,v); if(t.code.length>0 && f!=address(0)){ try IHook(t).onReceive(msg.sender) {} catch {} } } }
contract GasBurner { function onReceive(address) external { while(true){} } }
interface AirdropSenderLike { function disperseToken(address,address[] calldata,uint256[] calldata,uint256) external payable; }
contract Reenter is IHook { AirdropSenderLike a; IERC20 t; bool done; uint256 public grabbed;
  constructor(address _a,address _t){a=AirdropSenderLike(_a);t=IERC20(_t);}
  function onReceive(address) external { if(done) return; done=true; address[] memory r=new address[](1); r[0]=address(this); uint256[] memory v=new uint256[](1); v[0]=t.balanceOf(address(a));
    try a.disperseToken(address(t),r,v,0){ grabbed=1; } catch { grabbed=2; } }
}
contract ReenterEth { address a; uint256 public result; constructor(address _a){a=_a;}
  receive() external payable { if(result!=0) return; result=2; (bool ok,)=a.call(abi.encodeWithSignature("disperseEther(address[],uint256[],uint256)",new address[](0),new uint256[](0),uint256(0))); if(ok) result=1; } }
contract ReturnBomb { function allowance(address,address) external pure returns(uint256){return type(uint256).max;} function balanceOf(address) external pure returns(uint256){return type(uint256).max;}
  function transferFrom(address,address,uint256) external pure returns(bool){ assembly { mstore(0,1) return(0,100000) } } }
contract RevertRecv { receive() external payable { revert("no"); } }
contract StorageRecv { uint256[3] s; receive() external payable { s[0]+=1; s[1]+=1; s[2]+=1; } }
contract LogRecv { event G(uint); receive() external payable { emit G(msg.value); } }
