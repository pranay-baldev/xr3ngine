import { Component } from '../../ecs/classes/Component';
import { Types } from '../../ecs/types/Types';
import { AssetClass } from '../enums/AssetClass';
import { AssetType } from '../enums/AssetType';
import { AssetClassAlias, AssetsLoadedHandler, AssetTypeAlias } from '../types/AssetTypes';

export class AssetLoader extends Component<AssetLoader> {
  url: string = ''
  assetType: AssetTypeAlias = null
  assetClass: AssetClassAlias = null
  receiveShadow: boolean = false
  castShadow: boolean = false
  envMapOverride: any = null
  append: boolean = true
  onLoaded: AssetsLoadedHandler = null
  parent: any = null
}
AssetLoader.schema = {
  assetType: { default: AssetType.glTF, type: Types.Number },
  assetClass: { default: AssetClass, type: Types.Number },
  url: { default: '', type: Types.Number },
  receiveShadow: { default: false, type: Types.Boolean },
  castShadow: { default: false, type: Types.Boolean },
  envMapOverride: { default: null, type: Types.Ref },
  append: { default: true, type: Types.Boolean },
  onLoaded: { default: null, type: Types.Ref },
  parent: { default: null, type: Types.Ref }
};